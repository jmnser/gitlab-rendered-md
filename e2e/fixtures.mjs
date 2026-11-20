export const OLD = `# Guide

Intro paragraph that stays the same.

This paragraph will be reworded slightly in the new version.

This paragraph will be removed entirely.

- first item
- second item
- third item

| Name | Value |
|------|-------|
| a    | 1     |
| b    | 2     |

See [the other doc](other.md) and ![logo](img/logo.png).

<details>
<summary>More</summary>

Hidden text.

</details>

Footnote reference[^1].

[^1]: The footnote.
`;

export const NEW = `# Guide

Intro paragraph that stays the same.

This paragraph was reworded slightly in the new version.

A brand new paragraph was added here.

- first item
- 2nd item
- third item

| Name | Value |
|------|-------|
| a    | 1     |
| b    | 3     |

See [the other doc](other.md) and ![logo](img/logo.png).

<details>
<summary>More</summary>

Hidden text, now changed.

</details>

Footnote reference[^1].

[^1]: The footnote.
`;
