"""Code-quality gate (method-complexity skill): functions stay small and shallow."""

import ast
import unittest
from pathlib import Path

PKG = Path(__file__).resolve().parent.parent / "minutes_desk"
MAX_LINES = 60
MAX_BRANCHES = 12
ALLOWED = {"_routes", "build"}  # route table and docx package assembly are flat lists, not logic


def own_nodes(fn):
    """Nodes of a function, not descending into nested functions or classes (they are measured on their own)."""
    stack = list(fn.body)
    while stack:
        n = stack.pop()
        yield n
        if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            stack.extend(ast.iter_child_nodes(n))


class QualityTests(unittest.TestCase):
    def test_functions_are_small(self):
        problems = []
        for path in PKG.glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name not in ALLOWED:
                    lines = node.end_lineno - node.lineno + 1
                    branches = sum(isinstance(n, (ast.If, ast.For, ast.While, ast.Try, ast.BoolOp, ast.IfExp))
                                   for n in own_nodes(node))
                    nested = any(isinstance(n, (ast.FunctionDef, ast.ClassDef)) for n in node.body)
                    if branches > MAX_BRANCHES or (lines > MAX_LINES and not nested):
                        problems.append(f"{path.name}:{node.lineno} {node.name} ({lines} lines, {branches} branches)")
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main()
