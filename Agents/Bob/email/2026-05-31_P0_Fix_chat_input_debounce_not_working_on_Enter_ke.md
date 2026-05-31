---
from: Diana
to: Bob
subject: P0: Fix chat input debounce not working on Enter key
date: 2026-05-31
---

Bob,

User reported: when typing fast in the chat input and pressing Enter immediately, the message sometimes sends as empty string. The debounce should ensure the input value is captured before sending.

Please fix this in src/components/chat-panel.tsx. Add a 300ms debounce to the handleSend function so the last keystroke is captured before sending.

Estimated effort: 30 min.

�� Diana (PM)
