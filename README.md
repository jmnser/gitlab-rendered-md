# GitLab Rendered Markdown Review

A Firefox add-on to review and comment on Markdown files in GitLab merge requests as rendered documents
([gitlab-org/gitlab#17000](https://gitlab.com/gitlab-org/gitlab/-/issues/17000)).

## Install

Requires Node.js 22 and Firefox 142 or later.

```sh
npm install
npm run build
```

In Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on** and select
`dist/manifest.json`. Firefox removes temporary add-ons on restart.

## Usage

In the **Changes** tab of a merge request, click **Rendered** on a Markdown file. Click a block to comment on it; the
comment is a normal GitLab diff comment.

The add-on options add self-managed GitLab instances, open files rendered by default, and set how much unchanged
context is shown around changes.

## Limitations

- Mermaid, PlantUML and math appear as code.
- Threads from earlier MR versions are not shown.
- GitLab markup changes can break the add-on. All selectors are in [`src/content/gitlab-dom.js`](src/content/gitlab-dom.js).

## Development

`npm test` runs the unit tests, `npm run lint` lints the build, `npm start` opens Firefox with the add-on, and
`npm run package` builds the AMO zip. [`e2e/run.sh`](e2e/run.sh) runs an end-to-end test in the current kubectl context.

## License

[MIT](LICENSE)
