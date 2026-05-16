# Simplified shell with original node references

The prototype will support dramatic simplification by creating a **Simplified Shell**, using actionable **Original Node References** for interactive controls, and relocating only non-interactive original content into named **Shell Slots**. CSS-only patches were safer to introduce but produced weak simplification or broken pages when the model hid too much; moving interactive nodes also breaks sites that rely on delegated event handlers or parent-context assumptions.

**Considered Options**

- Keep CSS-only **Live UI Patches**.
- Generate replacement HTML from the Page Snapshot.
- Create a **Simplified Shell** and move all original nodes into it.
- Create a **Simplified Shell**, reference original controls in place, and move only non-interactive content.

**Consequences**

- A **Patch Plan** can now describe structural presentation operations such as creating a shell, referencing original controls, and moving safe content nodes.
- Reset must restore moved nodes to their original positions before removing the shell.
- Preserved interactive controls remain in their original DOM context; shell entries activate safe original controls directly and reveal sensitive or form-like controls instead of pretending to be replacement controls.
- The final model request should stay compact because Page Analysis and Simplification Strategy already compress the page.
