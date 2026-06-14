export const TOP_LEFT_BORDER_CHARS = new Set(['┌', '╔', '╒', '╓', '╭', '+'])
export const TOP_RIGHT_BORDER_CHARS = new Set(['┐', '╗', '╕', '╖', '╮', '+'])
export const BOTTOM_LEFT_BORDER_CHARS = new Set(['└', '╚', '╘', '╙', '╰', '+'])
export const BOTTOM_RIGHT_BORDER_CHARS = new Set(['┘', '╝', '╛', '╜', '╯', '+'])
export const MIDDLE_LEFT_BORDER_CHARS = new Set(['├', '╠', '╞', '╟', '+'])
export const MIDDLE_RIGHT_BORDER_CHARS = new Set(['┤', '╣', '╡', '╢', '+'])
export const VERTICAL_BORDER_CHARS = new Set(['│', '║', '┃', '|'])
export const HORIZONTAL_BORDER_PATTERN = /[─═━-]/
export const RIGHT_ARROW_PATTERN = /[▶►>→⇒↦⟶⟹]/
export const LEFT_ARROW_PATTERN = /[◀◁<←⇐↤⟵⟸]/
export const CONNECTOR_EDGE_PATTERN = /^[\s│║┃|─═━\-<>▶►◀◁→⇒←⇐↦↤⟵⟸⟶⟹]+|[\s│║┃|─═━\-<>▶►◀◁→⇒←⇐↦↤⟵⟸⟶⟹]+$/g
export const TRAILING_NOTE_PREFIX_PATTERN = /^[\s←⇐↤⟵⟸<]+/
export const BOX_FLOW_BORDER_COLUMN_TOLERANCE = 2
export const VERTICAL_FLOW_DOWN_ARROW_PATTERN = /[↓⇣⇩⭣⬇↧▼▽▾▿]|[vV](?=$|\s)/
export const VERTICAL_FLOW_UP_ARROW_PATTERN = /[↑⇡⇧⭡⬆↥▲△▴▵]|\^(?=$|\s)/
export const VERTICAL_FLOW_CONNECTOR_PATTERN =
  /^[\s│║┃|:.\-]*(?<arrow>(?:[↓⇣⇩⭣⬇↧▼▽▾▿↑⇡⇧⭡⬆↥▲△▴▵]+|[vV^]+(?=$|\s)))[\s│║┃|:.\-]*(?:(?<label>\S(?:.*\S)?)\s*)?$/
export const VERTICAL_FLOW_COMMENT_PATTERNS = [/\s+#\s+/, /\s+\/\/\s+/]
export const CONNECTOR_SCAFFOLD_LINE_PATTERN =
  /^[\s│║┃|:.\-↓⇣⇩⭣⬇↧▼▽▾▿↑⇡⇧⭡⬆↥▲△▴▵vV^<>▶►◀◁→⇒←⇐↦↤⟵⟸⟶⟹]+$/
export const BOX_TITLE_EDGE_PATTERN = /^[\s─═━-]+|[\s─═━-]+$/g
export const TRANSCRIPT_BRANCH_PREFIX_PATTERN = /^(?:(?:[│║┃|]\s*)|\s+)*(?:├|└|╰|╭|╮|╯)[\s─═━-]+/
export const TRANSCRIPT_INLINE_ARROW_PATTERN = /(?:->|=>|→|⇒|↦|⟶|⟹)/
export const TRANSCRIPT_INLINE_ARROW_SPLIT_PATTERN = /\s*(?:->|=>|→|⇒|↦|⟶|⟹)\s*/
export const TRANSCRIPT_INLINE_ARROW_MATCH_PATTERN = /(?:->|=>|→|⇒|↦|⟶|⟹)/g
export const TRANSCRIPT_TRAILING_CONTINUATION_ARROW_PATTERN = /\s*(?:->|=>|→|⇒|↦|⟶|⟹)\s*$/
export const TRANSCRIPT_LEADING_CONTINUATION_ARROW_PATTERN = /^\s*(?:->|=>|→|⇒|↦|⟶|⟹)\s+/
export const TRANSCRIPT_INLINE_BRANCH_SCAFFOLD_LINE_PATTERN = /^\s*(?:[│║┃|]\s*)+$/
export const TRANSCRIPT_INLINE_BRANCH_DETAIL_PATTERN =
  /^(?<prefix>\s*(?:(?:[│║┃|]\s*)*)(?:├|└|╰|╭|╮|╯)(?:[\s─═━-]*)(?:->|=>|→|⇒|↦|⟶|⟹)\s*)(?<content>\S(?:.*\S)?)\s*$/
export const BOX_DIAGRAM_BORDER_CHAR_PATTERN = /[┌┐└┘├┤┬┴┼│─┝┥┳┻╋╭╮╯╰╔╗╚╝║═]/
export const BOX_DIAGRAM_CONNECTOR_CHAR_PATTERN = /[▼▽▾▿▲△▴▵▶►◀◁→⇒←⇐↦↤⟵⟸⟶⟹]/
export const BOX_DIAGRAM_TEXTUAL_CONNECTOR_PATTERN = /(?:^|\s)(?:▼|▽|▾|▿|▲|△|▴|▵|▶|►|◀|◁|->|=>|<-|<=|<->|<=>|v|V|\^)(?:\s|$)/
export const BOX_DIAGRAM_MIN_BORDER_LINES = 3
export const ARCHITECTURE_DIVIDER_CENTER_CHARS = new Set(['┼', '┬', '┴', '╋', '┳', '┻', '╂', '╪'])
