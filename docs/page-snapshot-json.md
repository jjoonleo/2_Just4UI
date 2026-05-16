# Page Snapshot JSON Guide

This document explains the JSON file produced by the Bridge Page Snapshot extension. The sample reviewed is `downloaded_json/page-snapshot-2026-05-16T06-33-16-276Z.json`.

## What This File Is

| Item | Meaning |
| --- | --- |
| Purpose | A structured record of the browser page at the moment the user clicked **Extract current page**. |
| Main use | Inspect what page data is available before sending a smaller, safer version to an AI model later. |
| Privacy boundary | Form values are not included. Form fields are described with metadata only. |
| Storage behavior | The extension shows this as a one-time result unless the user copies or downloads it. |
| Screenshot | Optional. This sample includes a visible viewport screenshot in `visualSnapshot`. |

## Top-Level Fields

| Field | Type | Human meaning |
| --- | --- | --- |
| `schemaVersion` | String | Version of the snapshot format. Useful when the extractor changes later. |
| `collectedAt` | String | Timestamp when the snapshot was created. |
| `privacy` | Object | Flags describing privacy-relevant behavior for this snapshot. |
| `page` | Object | Basic information about the current web page. |
| `viewport` | Object | Browser viewport and document size at extraction time. |
| `content` | Object | The extracted page structure: headings, links, forms, images, and other page parts. |
| `visualSnapshot` | Object | Optional screenshot data for the visible browser viewport. Present only when screenshot capture is enabled. |

## Privacy Fields

| Field | Example | Meaning |
| --- | --- | --- |
| `privacy.userTriggered` | `true` | The snapshot was created only after the user clicked the extension. |
| `privacy.formValuesIncluded` | `false` | User-entered form values are not included. |
| `privacy.automaticRetention` | `false` | The extension does not automatically keep snapshot history. |
| `privacy.screenshotIncluded` | `false` in the privacy object | Intended flag for screenshot status. The reviewed sample still contains `visualSnapshot`, so this flag should be corrected in a future extractor update when screenshots are enabled. |

## Page Fields

| Field | Meaning |
| --- | --- |
| `page.url` | Full URL of the page being inspected. |
| `page.origin` | Website origin, such as `https://example.com`. |
| `page.title` | Browser page title. |
| `page.language` | Page language from the HTML document, if available. |
| `page.direction` | Text direction, such as `ltr` or `rtl`. |
| `page.charset` | Character encoding used by the page. |
| `page.canonicalUrl` | Canonical URL from page metadata, if available. |
| `page.metaDescription` | Page description from metadata, if available. |
| `page.metaRobots` | Search/indexing metadata, if available. |

## Viewport Fields

| Field | Meaning |
| --- | --- |
| `viewport.width` | Width of the visible browser viewport in CSS pixels. |
| `viewport.height` | Height of the visible browser viewport in CSS pixels. |
| `viewport.devicePixelRatio` | Ratio between CSS pixels and physical screen pixels. |
| `viewport.scrollX` | Horizontal scroll position when extracted. |
| `viewport.scrollY` | Vertical scroll position when extracted. |
| `viewport.documentWidth` | Full page width. |
| `viewport.documentHeight` | Full page height. |

## Content Sections

The `content` object is the most important part of the snapshot.

| Section | Count in sample | Meaning |
| --- | ---: | --- |
| `content.landmarks` | 29 | Major page regions such as navigation, main content, header, footer, forms, articles, and sections. |
| `content.headings` | 40 | Page headings and their levels. Useful for understanding page outline. |
| `content.textBlocks` | 75 | Visible text blocks such as paragraphs, labels, table cells, and list items. |
| `content.interactiveElements` | 71 | Things the user can interact with, such as links, buttons, inputs, selects, and ARIA controls. |
| `content.forms` | 1 | Forms and their fields, without user-entered values. |
| `content.links` | 62 | Visible links and their destinations. |
| `content.images` | 3 | Visible images with alt text, source URL, and size information. |
| `content.media` | 0 | Audio and video elements. |
| `content.tables` | 0 | Tables, captions, headers, and row/column estimates. |
| `content.lists` | 27 | Lists and estimated list item counts. |
| `content.dialogs` | 0 | Dialogs and alert dialogs, if present. |
| `content.liveRegions` | 1 | Dynamic status/alert areas announced by assistive technology. |

## Common Element Fields

Many extracted objects share these fields.

| Field | Meaning |
| --- | --- |
| `snapshotId` | Stable ID inside this snapshot, such as `interactive-1` or `form-1-field-2`. |
| `tag` | HTML tag name, such as `button`, `a`, `input`, or `section`. |
| `role` | ARIA role or inferred native role, such as `button`, `link`, `navigation`, or `heading`. |
| `label` | Accessible name when available. This is often what screen readers use. |
| `text` | Visible text for the element, shortened when long. |
| `textPreview` | Short preview of a larger region's text. |
| `selector` | CSS selector path that can help locate the element again. |
| `bounds` | Position and size of the element in the viewport. |
| `visible` | Whether the extractor considered the element visible. |

## Bounds Fields

`bounds` describes where an element appeared when the snapshot was taken.

| Field | Meaning |
| --- | --- |
| `x`, `y` | Element position relative to the viewport. |
| `width`, `height` | Element size. |
| `top`, `right`, `bottom`, `left` | Rectangle edges relative to the viewport. |
| `inViewport` | Whether the element overlaps the visible browser viewport. |

## Interactive Element Fields

| Field | Meaning |
| --- | --- |
| `type` | Input or button type, such as `text`, `button`, `checkbox`, or `submit`. |
| `name` | HTML `name` attribute, if present. |
| `href` | Link destination for anchor elements. |
| `disabled` | Whether the element is disabled. |
| `required` | Whether a field is required. |
| `checked` | Checked state for checkbox/radio controls only. |
| `expanded` | ARIA expanded state, often used by menus and accordions. |
| `hasPopup` | ARIA popup type, if the control opens a menu/dialog/listbox. |
| `controls` | ID of another element controlled by this element. |
| `describedBy` | Text referenced by `aria-describedby`, if available. |
| `placeholder` | Placeholder text for form controls. |
| `valueIncluded` | Always `false` for form controls in this milestone. |

## Form Fields

| Field | Meaning |
| --- | --- |
| `forms[].method` | Form HTTP method, usually `get` or `post`. |
| `forms[].actionOrigin` | Origin of the form submission target, without the full submitted URL details. |
| `forms[].fields` | List of fields and buttons inside the form. |
| `fields[].autocomplete` | Browser autocomplete hint, if present. |
| `fields[].readonly` | Whether the field is read-only. |
| `fields[].options` | Select/dropdown options, without selected user-entered values. |
| `fields[].valueIncluded` | Confirms that the actual field value was not included. |

## Image Fields

| Field | Meaning |
| --- | --- |
| `alt` | Alternative text for the image. Important for accessibility. |
| `title` | Image title text, if present. |
| `src` | Image URL. |
| `loading` | Browser loading mode, such as `lazy`, if present. |
| `naturalWidth`, `naturalHeight` | Real image dimensions. |
| `displayedWidth`, `displayedHeight` | Size displayed on the page. |

## Visual Snapshot Fields

| Field | Meaning |
| --- | --- |
| `visualSnapshot.kind` | Type of screenshot. In this sample: `visibleViewportScreenshot`. |
| `visualSnapshot.format` | Image format. In this sample: `png`. |
| `visualSnapshot.dataUrl` | Base64 PNG image data embedded directly in the JSON. This can make the file large. |

## How To Read This JSON

| Goal | Useful fields |
| --- | --- |
| Understand the page topic | `page.title`, `page.metaDescription`, `content.headings`, `content.textBlocks` |
| Find what an elderly user can click | `content.interactiveElements`, `content.links`, `content.forms` |
| Understand page layout | `content.landmarks`, `bounds`, `viewport`, `visualSnapshot` |
| Find accessibility labels | `label`, `role`, `describedBy`, `alt` |
| Detect confusing forms | `content.forms`, `fields[].label`, `fields[].required`, `fields[].placeholder` |
| Prepare Gemini input later | Prefer `page`, `viewport`, `headings`, `landmarks`, `interactiveElements`, `forms`, and selected `textBlocks`; avoid sending the full screenshot unless needed. |

## Notes For Future Cleanup

| Issue | Suggested fix |
| --- | --- |
| `privacy.screenshotIncluded` is `false` even though `visualSnapshot` exists in this sample. | Update the extractor to set this flag based on the screenshot checkbox. |
| `visualSnapshot.dataUrl` makes the JSON much larger. | Store screenshots separately or send them only for visual model calls. |
| `selector` values can be long and fragile. | Keep them for debugging, but do not rely on them as permanent IDs across page reloads. |
