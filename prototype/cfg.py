"""
Python source -> Mermaid flowchart.

The core idea: walk the AST and build a control-flow graph. Every visit
function takes the list of "loose ends" (nodes whose outgoing edge isn't
decided yet) and returns a new list of loose ends after handling the
statement. That's what makes nesting work correctly.
"""

import ast
import sys


class FlowchartBuilder:
    def __init__(self):
        self.nodes = []        # (id, label, shape)
        self.edges = []        # (from_id, to_id, label)
        self.counter = 0
        self.loop_stack = []   # (continue_target, break_collector) for break/continue

    def new_id(self):
        self.counter += 1
        return f"n{self.counter}"

    def add_node(self, label, shape="box", line=None):
        nid = self.new_id()
        self.nodes.append((nid, label, shape, line))
        return nid

    def connect(self, sources, target, label=None):
        """Wire every loose end to the target node."""
        for src in sources:
            self.edges.append((src, target, label))

    # ---- statement dispatch -------------------------------------------------

    def visit_body(self, stmts, entries):
        """Process a list of statements. Returns the new loose ends."""
        for stmt in stmts:
            entries = self.visit(stmt, entries)
            if not entries:
                break  # unreachable code after return/break/continue
        return entries

    def visit(self, node, entries):
        method = getattr(self, f"visit_{type(node).__name__}", self.visit_generic)
        return method(node, entries)

    def visit_generic(self, node, entries):
        """Plain statement: assignment, call, expression, etc."""
        label = self.describe(node)
        nid = self.add_node(label, "box", node.lineno)
        self.connect(entries, nid)
        return [nid]

    def visit_If(self, node, entries):
        cond = self.add_node(self.expr(node.test), "diamond", node.lineno)
        self.connect(entries, cond)

        true_ends = self.visit_body(node.body, [cond])
        # relabel the first edge out of the diamond
        self.label_last_edge_from(cond, "yes")

        if node.orelse:
            false_ends = self.visit_body(node.orelse, [cond])
            self.label_last_edge_from(cond, "no")
        else:
            false_ends = [cond]  # falls straight through

        merged = true_ends + false_ends
        return merged

    def visit_While(self, node, entries):
        cond = self.add_node(self.expr(node.test), "diamond", node.lineno)
        self.connect(entries, cond)

        breaks = []
        self.loop_stack.append((cond, breaks))
        body_ends = self.visit_body(node.body, [cond])
        self.loop_stack.pop()

        self.connect(body_ends, cond)          # back-edge
        return [cond] + breaks                 # exit when condition fails

    def visit_For(self, node, entries):
        label = f"for {self.expr(node.target)} in {self.expr(node.iter)}"
        cond = self.add_node(label, "diamond", node.lineno)
        self.connect(entries, cond)

        breaks = []
        self.loop_stack.append((cond, breaks))
        body_ends = self.visit_body(node.body, [cond])
        self.loop_stack.pop()

        self.connect(body_ends, cond)
        return [cond] + breaks

    def visit_Break(self, node, entries):
        nid = self.add_node("break", "box", node.lineno)
        self.connect(entries, nid)
        if self.loop_stack:
            self.loop_stack[-1][1].append(nid)
        return []  # nothing flows through a break

    def visit_Continue(self, node, entries):
        nid = self.add_node("continue", "box", node.lineno)
        self.connect(entries, nid)
        if self.loop_stack:
            self.connect([nid], self.loop_stack[-1][0])
        return []

    def visit_Return(self, node, entries):
        val = self.expr(node.value) if node.value else ""
        nid = self.add_node(f"return {val}".strip(), "round", node.lineno)
        self.connect(entries, nid)
        return []  # terminal

    def visit_FunctionDef(self, node, entries):
        """Functions get their own start node; they don't flow from the caller."""
        start = self.add_node(f"def {node.name}()", "round", node.lineno)
        ends = self.visit_body(node.body, [start])
        end = self.add_node("end", "round")
        self.connect(ends, end)
        return entries  # module flow continues unaffected

    # ---- label helpers ------------------------------------------------------

    def label_last_edge_from(self, src, label):
        for i in range(len(self.edges) - 1, -1, -1):
            if self.edges[i][0] == src and self.edges[i][2] is None:
                self.edges[i] = (self.edges[i][0], self.edges[i][1], label)
                return

    def expr(self, node):
        if node is None:
            return ""
        try:
            return ast.unparse(node)
        except Exception:
            return type(node).__name__

    def describe(self, node):
        try:
            text = ast.unparse(node)
        except Exception:
            text = type(node).__name__
        text = text.splitlines()[0]
        return text[:45] + ("..." if len(text) > 45 else "")

    # ---- output -------------------------------------------------------------

    def to_mermaid(self):
        out = ["flowchart TD"]
        for nid, label, shape, line in self.nodes:
            safe = label.replace('"', "'")
            if shape == "diamond":
                out.append(f'    {nid}{{"{safe}"}}')
            elif shape == "round":
                out.append(f'    {nid}(["{safe}"])')
            else:
                out.append(f'    {nid}["{safe}"]')
        for src, dst, label in self.edges:
            if label:
                out.append(f"    {src} -->|{label}| {dst}")
            else:
                out.append(f"    {src} --> {dst}")
        return "\n".join(out)


def build(source):
    tree = ast.parse(source)
    b = FlowchartBuilder()
    start = b.add_node("start", "round")
    ends = b.visit_body(tree.body, [start])
    if ends:
        end = b.add_node("end", "round")
        b.connect(ends, end)
    return b


if __name__ == "__main__":
    src = open(sys.argv[1], encoding="utf-8").read()
    print(build(src).to_mermaid())
