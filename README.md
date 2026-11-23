# GitLab Rendered Markdown Review

A Firefox add-on to read and comment on Markdown files in GitLab merge requests as rendered documents
instead of raw source ([gitlab-org/gitlab#17000](https://gitlab.com/gitlab-org/gitlab/-/issues/17000)).

## Install

The add-on is not on addons.mozilla.org yet. Build it and load it as a temporary add-on (Node.js 22+, Firefox 142+):

```sh
npm install
npm run build
```

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on** and select `dist/manifest.json`.

Firefox removes temporary add-ons on restart.

gitlab.com works right away. For a self-managed instance, add its URL in the add-on options and allow access when
Firefox asks.

## Usage

In the **Changes** tab of a merge request, click **Rendered** in the header of a Markdown file. Added blocks are green,
removed blocks red. Click a block to comment on it; the comment is a normal GitLab diff comment on the matching line.

## Limitations

- Mermaid, PlantUML and math appear as code.
- Threads from earlier MR versions are not shown in the rendered view.
- The add-on relies on GitLab's page markup. All selectors are in [`src/content/gitlab-dom.js`](src/content/gitlab-dom.js).

## Development

```sh
npm test          # unit tests
npm run lint      # build and run web-ext lint
npm start         # build and start Firefox with the add-on loaded
npm run package   # build a .zip for AMO into artifacts/
```

[`e2e/run.sh`](e2e/run.sh) runs an end-to-end test against a throwaway GitLab CE in the current kubectl context.

## License

[MIT](LICENSE)
