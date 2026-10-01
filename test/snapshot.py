#!/usr/bin/env python3
"""Deterministic screenshots of r_g_b.html, for checking that a refactor doesn't change the output.

    test/snapshot.py PAGE OUTDIR [--frames N] [--seed S]
    test/snapshot.py --diff DIR1 DIR2

PAGE is a file, or REV:FILE from git (e.g. HEAD:r_g_b.html), loaded along with the rest of the tree
at REV. If PAGE's directory has a vite.config.ts, the page is built first, unminified, with that
directory's node_modules (for REV, the working tree's, so both sides of a dependency bump would
build with the same versions). For each of a few mouse positions, headless Chrome (SwiftShader
WebGL2) loads the page; once the DOM is loaded, it renders N more frames by calling the captured
requestAnimationFrame callback, and saves the screen to OUTDIR/mouse-X-Y.png.

Math.random is seeded, with separate streams for three.js's generateUUID and for everything else,
so kernels don't depend on how many objects three.js creates; a page whose generateUUID can't be
found is an error. The mouse is placed by calling the mousemove listener as soon as it's added.
Date.now() and performance.now() start frozen and advance 500 ms per frame, so 150 frames cross the
60 s kernel swap.

Example: test/snapshot.py HEAD:r_g_b.html /tmp/a && test/snapshot.py r_g_b.html /tmp/b &&
test/snapshot.py --diff /tmp/a /tmp/b
"""
import argparse, base64, concurrent.futures, html, json, os, re, struct, subprocess, sys, tempfile, zlib

MICE = [(0.5, 0.5), (0.9, 0.3), (0.15, 0.75), (0.6, 0.97)]

PRE = """<script>
(() => {
    const mulberry32 = s => () => {
        s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    const pageRandom = mulberry32(%(seed)d), libraryRandom = mulberry32(~%(seed)d);
    // Stack line 2 is Math.random's caller.
    window.__libraryCalls = 0;
    Math.random = () => new Error().stack.split("\\n")[2].includes(" at generateUUID") ? (__libraryCalls++, libraryRandom()) : pageRandom();
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
    const addEventListener = window.addEventListener;
    window.addEventListener = function (type, listener, options) {
        addEventListener.call(this, type, listener, options);
        if (type === "mousemove") {
            const x = %(mouseX)s * innerWidth, y = %(mouseY)s * innerHeight;
            listener({ pageX: x, pageY: y, clientX: x, clientY: y });
        }
    };
})();
</script>
"""

POST = """<script>
document.addEventListener("DOMContentLoaded", () => {
    const out = document.createElement("pre");
    out.id = "out";
    try {
        for (let i = 0; i < %(frames)d; i++) {
            __elapsed += 500;
            const cb = __frame;
            __frame = null;
            cb(performance.now());
        }
        if (!__libraryCalls) {
            __errors.push("harness: no Math.random calls from generateUUID; is three.js minified?");
        }
        const gl = [...document.querySelectorAll("canvas")].map(c => c.getContext("webgl2")).find(Boolean);
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const px = new Uint8Array(w * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let bin = "";
        for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode(...px.subarray(i, i + 0x8000));
        out.textContent = JSON.stringify({ w, h, errors: __errors, px: btoa(bin) });
    } catch (e) {
        out.textContent = JSON.stringify({ errors: [...__errors, "harness: " + e.stack] });
    }
    document.body.append(out);
});
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


def load_page(page, tmp):
    """Returns (html, directory that relative URLs resolve against)."""
    rev, sep, path = page.partition(":")
    if sep and not os.path.exists(page):
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True,
                             check=True).stdout.strip()
        tree = os.path.join(tmp, "tree")
        os.mkdir(tree)
        archive = subprocess.run(["git", "-C", top, "archive", rev], capture_output=True, check=True).stdout
        subprocess.run(["tar", "-x", "-C", tree], input=archive, check=True)
        os.symlink(os.path.join(top, "node_modules"), os.path.join(tree, "node_modules"))
        page = os.path.join(tree, path)
    root = os.path.dirname(os.path.abspath(page))
    if os.path.exists(os.path.join(root, "vite.config.ts")):
        # Unminified, so that PRE can find generateUUID in stacks.
        dist = os.path.join(tmp, "dist")
        subprocess.run([os.path.join(root, "node_modules/.bin/vite"), "build", "--logLevel", "error",
                        "--minify", "false", "--outDir", dist, "--emptyOutDir"], cwd=root, check=True)
        page = os.path.join(dist, os.path.basename(page))
    return open(page).read(), os.path.dirname(os.path.abspath(page))


def snapshot(src, base, outdir, mouse, frames, seed):
    pre = PRE % {"seed": seed, "mouseX": mouse[0], "mouseY": mouse[1]}
    page = src.replace("<head>", f'<head>\n<base href="file://{base}/">\n' + pre, 1)
    end = page.rindex("</body>")
    page = page[:end] + POST % {"frames": frames} + page[end:]
    with tempfile.TemporaryDirectory() as tmp:
        test_page = os.path.join(tmp, "page.html")
        open(test_page, "w").write(page)
        # --allow-file-access-from-files lets file:// pages import ES modules.
        dom = subprocess.run(["google-chrome", "--headless=new", "--use-angle=swiftshader",
                              "--enable-unsafe-swiftshader", "--allow-file-access-from-files",
                              "--window-size=640,480", "--no-first-run", f"--user-data-dir={tmp}/profile",
                              "--dump-dom", "file://" + test_page],
                             capture_output=True, text=True, timeout=600).stdout
    m = re.search(r'<pre id="out">(.*?)</pre>', dom, re.S)
    res = json.loads(html.unescape(m.group(1))) if m else {"errors": ["harness: no output"]}
    name = "mouse-%.2f-%.2f.png" % mouse
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
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("a")
    ap.add_argument("b")
    args = ap.parse_args()
    if args.diff:
        sys.exit(0 if diff(args.a, args.b) else 1)

    os.makedirs(args.b, exist_ok=True)
    for name in os.listdir(args.b):
        if re.fullmatch(r"mouse-.*\.png", name):
            os.remove(os.path.join(args.b, name))
    with tempfile.TemporaryDirectory() as tmp, concurrent.futures.ThreadPoolExecutor() as pool:
        src, base = load_page(args.a, tmp)
        results = list(pool.map(lambda m: snapshot(src, base, args.b, m, args.frames, args.seed), MICE))
    for name, w, h, errors in results:
        print(f"{name}: {w}x{h}" + "".join(f"\n  {e}" for e in errors))
    sys.exit(1 if any(errors for *_, errors in results) else 0)


if __name__ == "__main__":
    main()
