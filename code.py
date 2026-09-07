import ast, sys

src = open(sys.argv[1]).read()
tree = ast.parse(src)

lines = ["flowchart TD"]
counter = [0]

def new_id():
    counter[0] += 1
    return f"n{counter[0]}"

def walk(nodes, parent):
    for node in nodes:
        nid = new_id()
        if isinstance(node, ast.If):
            lines.append(f'{nid}{{"if {ast.unparse(node.test)}"}}')
            lines.append(f"{parent} --> {nid}")
            walk(node.body, nid)
            if node.orelse:
                walk(node.orelse, nid)
        elif isinstance(node, (ast.For, ast.While)):
            lines.append(f'{nid}["loop"]')
            lines.append(f"{parent} --> {nid}")
            walk(node.body, nid)
            lines.append(f"{nid} --> {nid}")
        else:
            lines.append(f'{nid}["{ast.unparse(node).splitlines()[0][:40]}"]')
            lines.append(f"{parent} --> {nid}")
        parent = nid

start = new_id()
lines.append(f'{start}(["start"])')
walk(tree.body, start)
print("\n".join(lines))
