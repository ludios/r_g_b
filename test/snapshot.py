#!/usr/bin/env python3
"""Deterministic screenshots of the page, for checking that a refactor doesn't change the output.

    test/snapshot.py SOURCE OUTDIR [--frames N]
    test/snapshot.py --diff DIR1 DIR2

SOURCE is the project's directory (normally .), or a git revision of the current repository. Either
is copied to a scratch tree (a directory's tracked and untracked-but-not-ignored files; a revision's
tree from git) and built there with SOURCE's node_modules (for a revision, the working tree's, so
both sides of a dependency bump build with the same versions).

For each query string in QUERIES (settings and a kernel number), headless Chrome (SwiftShader
WebGL2) loads the page from a local http server. Once the page has asked for an animation frame,
the harness calls the captured requestAnimationFrame callback N more times and saves the screen to
OUTDIR/<query>.png. Math.random is seeded, and Date.now() and performance.now() start frozen and
advance 500 ms per frame.

Example: test/snapshot.py HEAD /tmp/a && test/snapshot.py . /tmp/b && test/snapshot.py --diff /tmp/a /tmp/b
"""
import argparse, base64, concurrent.futures, functools, http.server, json, os, shutil, signal, struct, subprocess, sys, tempfile, threading, zlib

QUERIES = ["k=1", "k=2&c=3.5&s=4", "k=3&s=40&p=0.5&ms=60", "k=4&c=1.2&s=2&j=0"]

PRE = """<script>
(() => {
    let s = 1;
    Math.random = () => {  // mulberry32
        s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    window.__elapsed = 0;
    Date.now = () => 1e12 + __elapsed;
    performance.now = () => 1000 + __elapsed;
    window.__frame = null;
    window.requestAnimationFrame = cb => { __frame = cb; return 1; };
    window.cancelAnimationFrame = () => { __frame = null; };
    window.__errors = [];
    for (const level of ["error", "warn"]) {
        const orig = console[level];
        console[level] = (...args) => { __errors.push(level + ": " + args.join(" ")); orig(...args); };
    }
    window.addEventListener("error", e => __errors.push("uncaught: " + e.message));
})();
</script>
"""

POST = """<script>
// SvelteKit starts asynchronously, once its bundle is imported, so this waits for the page's
// first requestAnimationFrame.
(function run(polls) {
    if (!__frame && polls < 3000) {
        setTimeout(run, 10, polls + 1);
        return;
    }
    let result;
    try {
        if (!__frame) {
            throw new Error("the page never asked for an animation frame");
        }
        for (let i = 0; i < %(frames)d; i++) {
            __elapsed += 500;
            const cb = __frame;
            __frame = null;
            cb(performance.now());
        }
        const gl = [...document.querySelectorAll("canvas")].map(c => c.getContext("webgl2")).find(Boolean);
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const px = new Uint8Array(w * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let bin = "";
        for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode(...px.subarray(i, i + 0x8000));
        result = { w, h, errors: __errors, px: btoa(bin) };
    } catch (e) {
        result = { errors: [...__errors, "harness: " + e.stack] };
    }
    fetch("/result/%(index)d", { method: "POST", body: JSON.stringify(result) });
})(0);
</script>
"""


def write_png(path, w, h, rgba_bottom_up):
    rows = [rgba_bottom_up[(h - 1 - y) * w * 4:(h - y) * w * 4] for y in range(h)]
    raw = b"".join(b"\0" + row for row in rows)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def read_png(path):
    """Reads PNGs written by write_png (unfiltered RGBA) only."""
    data = open(path, "rb").read()
    w, h = struct.unpack(">II", data[16:24])
    idat, pos = b"", 8
    while pos < len(data):
        n, = struct.unpack(">I", data[pos:pos + 4])
        if data[pos + 4:pos + 8] == b"IDAT":
            idat += data[pos + 8:pos + 8 + n]
        pos += 12 + n
    raw = zlib.decompress(idat)
    return w, h, [raw[y * (w * 4 + 1) + 1:(y + 1) * (w * 4 + 1)] for y in range(h)]


def build(source, tmp):
    """Copies SOURCE to a scratch tree under tmp, builds it, and returns the directory to serve."""
    tree = os.path.join(tmp, "tree")
    os.mkdir(tree)
    if os.path.isdir(source):
        top = source
        listed = subprocess.run(["git", "-C", source, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                                capture_output=True, check=True).stdout.decode().split("\0")
        for name in listed:
            if name and os.path.isfile(os.path.join(source, name)):  # Deleted files are still listed
                os.makedirs(os.path.dirname(os.path.join(tree, name)), exist_ok=True)
                shutil.copy2(os.path.join(source, name), os.path.join(tree, name))
    else:
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True,
                             check=True).stdout.strip()
        archive = subprocess.run(["git", "-C", top, "archive", source], capture_output=True, check=True).stdout
        subprocess.run(["tar", "-x", "-C", tree], input=archive, check=True)
    os.symlink(os.path.abspath(os.path.join(top, "node_modules")), os.path.join(tree, "node_modules"))
    subprocess.run([os.path.join(tree, "node_modules/.bin/vite"), "build", "--logLevel", "error"], cwd=tree,
                   check=True, stdout=subprocess.DEVNULL)  # The adapter chats on stdout
    return os.path.join(tree, "build")


class Server(http.server.ThreadingHTTPServer):
    """Serves the pages under a directory, and takes their results by POST /result/<index>."""

    def __init__(self, directory):
        self.directory = directory
        self.results = {}
        self.arrived = threading.Condition()

        class Handler(http.server.SimpleHTTPRequestHandler):
            def do_POST(handler):
                body = handler.rfile.read(int(handler.headers["Content-Length"]))
                with self.arrived:
                    self.results[int(handler.path.rsplit("/", 1)[1])] = json.loads(body)
                    self.arrived.notify_all()
                handler.send_response(204)
                handler.end_headers()

            def log_message(handler, *args):
                pass

        super().__init__(("127.0.0.1", 0), functools.partial(Handler, directory=directory))

    def wait_for(self, index, timeout):
        with self.arrived:
            self.arrived.wait_for(lambda: index in self.results, timeout)
            return self.results.get(index, {"errors": ["harness: no result in %d s" % timeout]})


def snapshot(server, served, index, outdir, query, frames):
    """Loads a copy of the page at /<index>/?<query>; returns (file name, w, h, errors)."""
    shutil.copytree(served, os.path.join(server.directory, str(index)))
    path = os.path.join(server.directory, str(index), "index.html")
    src = open(path).read().replace("<head>", "<head>\n" + PRE, 1)
    end = src.rindex("</body>")
    open(path, "w").write(src[:end] + POST % {"frames": frames, "index": index} + src[end:])
    with tempfile.TemporaryDirectory() as profile:
        chrome = subprocess.Popen(["google-chrome", "--headless=new", "--use-angle=swiftshader",
                                   "--enable-unsafe-swiftshader", "--window-size=640,480", "--no-first-run",
                                   f"--user-data-dir={profile}",
                                   f"http://127.0.0.1:{server.server_port}/{index}/?{query}"],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        try:
            res = server.wait_for(index, 600)
        finally:
            os.killpg(chrome.pid, signal.SIGTERM)
            chrome.wait()
    name = query.replace("&", ",") + ".png"
    if "px" in res:
        write_png(os.path.join(outdir, name), res["w"], res["h"], base64.b64decode(res["px"]))
    return name, res.get("w"), res.get("h"), res["errors"]


def diff(dir1, dir2):
    ok = True
    for name in sorted(set(os.listdir(dir1)) | set(os.listdir(dir2))):
        if not all(os.path.exists(os.path.join(d, name)) for d in (dir1, dir2)):
            print(f"{name}: missing from one side")
            ok = False
            continue
        w1, h1, rows1 = read_png(os.path.join(dir1, name))
        w2, h2, rows2 = read_png(os.path.join(dir2, name))
        if (w1, h1) != (w2, h2):
            print(f"{name}: size {w1}x{h1} vs {w2}x{h2}")
            ok = False
            continue
        n = sum(r1[i:i + 3] != r2[i:i + 3] for r1, r2 in zip(rows1, rows2) for i in range(0, w1 * 4, 4))
        print(f"{name}: {n} of {w1 * h1} pixels differ")
        ok &= n == 0
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--diff", action="store_true")
    ap.add_argument("--frames", type=int, default=150)
    ap.add_argument("a")
    ap.add_argument("b")
    args = ap.parse_args()
    if args.diff:
        sys.exit(0 if diff(args.a, args.b) else 1)

    os.makedirs(args.b, exist_ok=True)
    for name in os.listdir(args.b):
        if name.endswith(".png"):
            os.remove(os.path.join(args.b, name))
    with tempfile.TemporaryDirectory() as tmp:
        served = build(args.a, tmp)
        os.mkdir(os.path.join(tmp, "www"))
        server = Server(os.path.join(tmp, "www"))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            results = list(pool.map(lambda iq: snapshot(server, served, iq[0], args.b, iq[1], args.frames),
                                    enumerate(QUERIES)))
        server.shutdown()
    for name, w, h, errors in results:
        print(f"{name}: {w}x{h}" + "".join(f"\n  {e}" for e in errors))
    sys.exit(1 if any(errors for *_, errors in results) else 0)


if __name__ == "__main__":
    main()
