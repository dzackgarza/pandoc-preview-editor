# Feature: Agent Chat Integration

**Priority: Low (exploratory/speculative)**

## User Outcome

From within pandoc-preview, the user can invoke an AI agent (e.g., OpenCode) that has
access to the current document buffer, can propose edits (with accept/reject diff UI),
interact with Zotero for reference extraction, generate diagrams/code blocks, and
receive pandoc compilation feedback to iterate.

## Reference Implementations

### windyboy/opencode-obsidian

The most architecturally relevant reference.
Connects to `opencode serve` (HTTP + SSE) from inside Obsidian, with a permission-gated
tool system:

- **6 Obsidian tools**: read note, write note, search vault, list files, read directory,
  get file info — each with permission levels (read-only, scoped-write, full-write)
- **Chat UI**: Streaming responses, conversation management, slash commands
- **Agent/skill system**: Custom agents from `.opencode/agent/*.md`, skills from
  `.opencode/skill/*/SKILL.md`
- **Permission workflow**: Write operations require user approval via modal dialogs
- **Connection lifecycle**: Reconnect, error handling, status indicator

### mtymek/opencode-obsidian

Simpler approach — embeds OpenCode's web view
(`opencode serve --cors app://obsidian.md`) directly in the Obsidian sidebar.
Key details:

- **Context injection**: Sends open notes and selected text to the agent via `opencode`
  CLI's file-based context mechanism
- **No custom chat UI**: Uses OpenCode's own web interface embedded via iframe
- **Textarea-level access**: Reads from CodeMirror editor to get current document

### Zed + ACP (Agent Client Protocol)

Zed connects to OpenCode via `opencode acp` (JSON-RPC over stdio).
ACP standardizes how editors expose buffers, selections, file tree, and diagnostic info
to agents. Relevant for understanding what context an agent needs.

### Antigravity / AI Diff Review

Antigravity (Google's VS Code fork) and the `ai-diff-review-mcp` VS Code extension both
implement a diff review panel where AI-proposed edits are shown as interactive diffs
that the user can accept or reject per block.
This is the model for the accept/reject UI.

## Architecture Considerations for pandoc-preview

### Communication Protocol

ACP is a JSON-RPC message specification, not a transport.
The [spec](https://agentclientprotocol.com) defines messages for session management,
prompt processing, tool calls, and file operations — transport-agnostic.
Local agents typically use stdio; remote agents can use HTTP or WebSocket.
During `initialize`, the client advertises its own capabilities (file read/write,
terminal, etc.) — the editor tells the agent what it can do.

Three integration approaches for pandoc-preview:

| Approach | Mechanism | Pros | Cons |
| --- | --- | --- | --- |
| **Embed OpenCode web view** (iframe) | `opencode serve --cors` in an iframe sidebar | Zero chat UI code; full OpenCode TUI/Web | No custom tools; limited context injection |
| **OpenCode Server HTTP+SSE** (windyboy approach) | Connect to `opencode serve` REST API; implement custom tool registry | Full custom tool control; permission UX; streaming | Most implementation work |
| **ACP client in the app** | Implement ACP JSON-RPC directly (over WebSocket to a remote agent, or stdio to a local subprocess via a thin bridge) | Standardized protocol; interop with any ACP agent | Protocol is young; tool/permission model may not map 1:1 to app concerns |

ACP's key advantage is interoperability — the app could talk to OpenCode, Kiro, or any
ACP-compatible agent without custom integration per agent.
The client simply advertises capabilities (file tree access, buffer read/write, render
status, Zotero tools) during `initialize` and the agent adapts to what's available.

### Required Tools for the Agent

The agent needs tools that match the app's own responsibilities (per AGENTS.md):

| Tool | Purpose | Implementation |
| --- | --- | --- |
| `read_current_buffer` | Get the current document text | Textarea `.value` |
| `get_file_path` | Know the save target | App file state |
| `edit_buffer` | Propose an edit to the document | Requires diff review UI |
| `save_file` | Write edits to disk | App's existing save path |
| `get_render_errors` | Get pandoc compilation errors | Server render stderr |
| `trigger_render` | Request a re-render | `/api/render` |
| `search_zotero` | Find papers/references | Zotero API tool |
| `read_paper_content` | Extract text from a paper | Zotero + PDF extraction |
| `open_file` | Switch to a different file | File open endpoint |

### Diff Review and Accept/Reject

Agent-proposed edits need a review surface.
Two options:

**Option A: CriticMarkup as the diff format**

The agent returns a CriticMarkup-annotated version of the document.
The existing CriticMarkup rendering pipeline (pancritic) renders it in preview, showing
insertions/deletions/substitutions.
The user can manually resolve each annotation.

This aligns with the existing criticmarkup-gui-interaction card — the accept/reject
mechanism for CriticMarkup annotations would double as the agent edit review surface.

**Option B: Side-by-side diff panel**

A dedicated UI component shows the diff (like Antigravity's review panel).
The user accepts or rejects each chunk.
On accept, the textarea is updated.

CriticMarkup is the more natural fit for pandoc-preview because:
- It's already in the render pipeline
- It renders inline in the preview, not in a separate diff panel
- Accept/reject GUI (from criticmarkup-gui-interaction card) works on the same data
- The "conversation" around an edit maps naturally to CriticMarkup annotations

### Buffer Context Delivery

The agent needs to know the current document state.
Options:

1. **Pass as tool argument**: `read_current_buffer` returns the full text
2. **Inject into system prompt**: Prepended to each agent message (costly for large
   docs)
3. **File-based** (like mtymek): Write buffer to a temp file, point agent at it

Option 1 is cleanest — the agent calls `read_current_buffer` when it needs context, and
the response includes the text + file path + cursor position.

### Use Cases (in priority order per user)

| Use Case | Agent Capability Needed | Existing App Dependency |
| --- | --- | --- |
| **Insert theorem statement from Zotero paper** | `search_zotero` + `read_paper_content` → generate block → `edit_buffer` | Zotero API, PDF extraction |
| **Generate TikZ diagram from description** | `edit_buffer` → `trigger_render` → `get_render_errors` → iterate | TikZJax, pandoc render |
| **General document writing assistance** | `read_current_buffer` + `edit_buffer` | CriticMarkup diff review |
| **Code block assistance** | `edit_buffer` + `get_render_errors` | pandoc render |

## Outstanding Research Questions

1. **Activation model**: Does the user start a conversation explicitly (click "Chat"
   button), or does the agent sit in the background and can be invoked contextually
   (e.g., select text → "Ask agent to expand this")?

2. **OpenCode server dependency**: Should the app bundle a recommended OpenCode config
   (agents, tools, skills) or leave it entirely to the user's existing setup?

3. **Permission model**: How granular should edit approvals be?
   Per-edit, per-conversation, or trusted-agent mode with no approvals?

4. **State persistence**: Should agent conversations be saved as markdown files in the
   workspace (like windyboy's session export), or ephemeral?

5. **CriticMarkup coupling**: If agent edits use CriticMarkup as the diff format, does
   the criticmarkup-gui-interaction card become a prerequisite for this feature?

## Non-goals

- Do not build a general-purpose code editor agent (that's OpenCode's job).
  Focus on document-specific agent capabilities: writing, referencing, diagramming,
  compiling.
- Do not bundle or manage OpenCode installation.
  Assume the user has it separately (like pandoc).
