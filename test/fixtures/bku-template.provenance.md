# BKU template fixture provenance

- Source DOCX: `/Users/gnx/Downloads/Extension_render_problem.docx`
- Recovery date: 2026-08-18
- Extraction rule:

  ```sh
  textutil -convert txt -stdout "/Users/gnx/Downloads/Extension_render_problem.docx" |
    perl -0777 -ne 'if (/(<html\b[\s\S]*?<\/html>)/i) { print $1 }'
  ```

- Raw extraction byte length: `10,422` bytes.
- Raw extraction SHA-256: `fee427bbf27a15e4c0d846ec0249015924d76551880842326291fa44b137e490`
- Transformation: append exactly one final LF (`\n`).
- Tracked `test/fixtures/bku-template.html` byte length: `10,423` bytes.
- Tracked `test/fixtures/bku-template.html` SHA-256: `0005e3eff97cc3aa39bbb2d90aa5b6f76b4435eb4b679d5ae3e1182b61c24b2a`
- Hand-checked structural facts: six `table` elements; one `style` element; BKU heading classes; global reset selectors; inline styles; and an `@media print` rule.

The DOCX represented the literal HTML/CSS text through OOXML text runs. It did not contain an embedded standalone HTML part, so no original standalone-file name, bytes, encoding/container metadata, or other file-level provenance can be recovered or claimed.
