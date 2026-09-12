"""Every callable the frontend invokes must exist on the backend Plugin class.

This exists because it didn't: 63078f1 deleted `get_all_provider` while adding
IGDB enrichment, and nothing noticed for three beta cuts. tsc cannot see across
the bridge — callable<>("name") is just a string — so the contract needs its own
check. Parses both sides rather than importing, so it is cheap and total.
"""
import ast, os, re, sys
ROOT = os.environ.get("EGV_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

src = open(os.path.join(ROOT, "main.py"), encoding="utf-8").read()
backend = set()
for node in ast.parse(src).body:
    if isinstance(node, ast.ClassDef) and node.name == "Plugin":
        backend = {m.name for m in node.body
                   if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))}

wanted = {}
for dirpath, _dirs, files in os.walk(os.path.join(ROOT, "src")):
    for fn in files:
        if not fn.endswith((".ts", ".tsx")):
            continue
        path = os.path.join(dirpath, fn)
        text = open(path, encoding="utf-8").read()
        # callable<...>("name")  — the generic may span lines
        for m in re.finditer(r'callable\s*<.*?>\s*\(\s*["\']([A-Za-z_][A-Za-z0-9_]*)["\']',
                             text, re.S):
            wanted.setdefault(m.group(1), os.path.relpath(path, ROOT))

assert backend, "could not parse the Plugin class"
assert wanted, "found no callables in src/ — the regex is wrong, not the code"

missing = sorted((n, f) for n, f in wanted.items() if n not in backend)
print(f"{len(wanted)} callables referenced by the frontend; "
      f"{len(backend)} methods on Plugin")
for name in sorted(wanted):
    print(f"  {'OK  ' if name in backend else 'MISS'} {name}")
if missing:
    print("\nFAIL — the frontend calls backend methods that do not exist:")
    for name, where in missing:
        print(f"  {name}  (referenced in {where})")
    sys.exit(1)
print("\nPASS — every frontend callable resolves to a Plugin method")
