"""Swap the Web3Forms access key in every lead form and in audit.py.

Usage:
    python scripts/swap_form_key.py NEW-KEY-HERE

Replaces the key currently listed in CONFIG["form_key"] (scripts/audit.py)
with NEW-KEY, in every *.html file and in audit.py itself. Prints each file
touched. Run scripts/audit.py afterwards; it fails unless every form
carries the new key.
"""
import glob, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIT = os.path.join(ROOT, "scripts", "audit.py")
KEY_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

def main():
    if len(sys.argv) != 2 or not KEY_RE.match(sys.argv[1]):
        sys.exit("usage: swap_form_key.py <new-web3forms-key>  (uuid format)")
    new = sys.argv[1]
    audit = open(AUDIT, encoding="utf-8").read()
    old = re.search(r'"form_key":\s*"([0-9a-f-]{36})"', audit).group(1)
    if old == new:
        sys.exit("new key is the same as the current key; nothing to do")
    files = glob.glob(os.path.join(ROOT, "**", "*.html"), recursive=True) + [AUDIT]
    touched = 0
    for p in files:
        if os.sep + "node_modules" + os.sep in p:
            continue
        s = open(p, encoding="utf-8", newline="").read()
        if old not in s:
            continue
        open(p, "w", encoding="utf-8", newline="").write(s.replace(old, new))
        touched += 1
        print("swapped:", os.path.relpath(p, ROOT))
    print(f"{touched} files updated ({old} -> {new}). Now run: python scripts/audit.py .")

if __name__ == "__main__":
    main()
