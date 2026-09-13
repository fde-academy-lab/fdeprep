# G002: Remove one unsafe promise

Generative AI · Easy

Edit the supplied system prompt by removing exactly the word always and one following space in the first sentence. Preserve every other byte, including the later occurrence of always, punctuation and newline. This micro-exercise measures a precise edit, not whether the resulting prompt is behaviorally sufficient.

## Interface

`solve({text:string}) -> edited string`

## Passing rule

Every listed case must pass. Input objects use JSON-compatible types and string keys. Additional published constraints must be versioned. The authoring test file and instructor solution are private instructional assets and must never be staged with candidate code in production.
