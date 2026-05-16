const SNAPSHOT_URL = "./page-snapshot-2026-05-16T06-33-16-276Z.json";

const state = {
  snapshot: null,
  links: [],
  headings: [],
  textBlocks: [],
};

const $ = (selector) => document.querySelector(selector);

function textOf(item) {
  return (item?.text || item?.label || "").trim();
}

function uniqueByText(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${textOf(item)}|${item.href || ""}`;
    if (!textOf(item) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function slug(value, index) {
  return `section-${index}-${value.replace(/\s+/g, "-").replace(/[^\w-]/g, "").slice(0, 24) || "item"}`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2200);
}

function renderNav() {
  const top = uniqueByText(state.links).filter((link) =>
    ["문서", "우수사례", "블로그", "Chrome의 새로운 기능"].includes(textOf(link))
  );
  $("#topNav").innerHTML = top
    .map((link) => `<a class="${textOf(link) === "문서" ? "active" : ""}" href="${link.href}">${textOf(link)}</a>`)
    .join("");

  const docs = uniqueByText(state.links).filter((link) =>
    ["개요", "시작하기", "개발", "방법 안내", "AI", "참조", "샘플", "Chrome Web Store"].includes(textOf(link))
  );
  $("#docNav").innerHTML = docs
    .map((link) => `<a class="${textOf(link) === "AI" ? "active" : ""}" href="${link.href}">${textOf(link)}</a>`)
    .join("");

  const crumbs = uniqueByText(state.links).filter((link) =>
    ["Docs", "Chrome Extensions", "Extensions and AI"].includes(textOf(link))
  );
  $("#breadcrumbs").innerHTML = crumbs.map((link) => `<a href="${link.href}">${textOf(link)}</a>`).join("");

  const home = state.links.find((link) => link.href === state.snapshot.page.origin + "/") || state.links.find((link) => link.href === "https://developer.chrome.com/");
  if (home) $("[data-home-link]").href = home.href;

  const signIn = state.links.find((link) => textOf(link) === "로그인");
  if (signIn) $("#signInLink").href = signIn.href;
}

function mainContentTextBlocks() {
  return state.textBlocks.filter((block) =>
    ["mainContent", "sectionHeading"].includes(block.importance) && textOf(block)
  );
}

function renderArticle() {
  const page = state.snapshot.page;
  const mainBlocks = mainContentTextBlocks();
  const headings = state.headings.filter((heading) => heading.visible && heading.level && textOf(heading));
  const uniqueHeadings = [...new Map(headings.map((heading) => [textOf(heading), heading])).values()];

  $("#pageTitle").textContent = uniqueHeadings[0]?.text || page.title;
  $("#metaDescription").textContent = page.metaDescription || page.canonicalUrl || page.url;
  $("#intro").textContent =
    mainBlocks.find((block) => textOf(block).includes("AI는 머신러닝"))?.text ||
    "Chrome 확장 프로그램에서 AI를 효과적으로 사용하는 방법을 이해하는 데 도움이 되는 리소스를 찾아보세요.";
  $("#canonicalLink").href = page.canonicalUrl || page.url;

  const sectionHeads = uniqueHeadings.filter((heading) => heading.level <= 3).slice(1);
  $("#tocNav").innerHTML = sectionHeads
    .map((heading, index) => `<a href="#${slug(heading.text, index)}">${heading.text}</a>`)
    .join("");

  const content = sectionHeads.map((heading, index) => {
    const id = slug(heading.text, index);
    const startY = heading.bounds?.top ?? 0;
    const nextY = sectionHeads[index + 1]?.bounds?.top ?? Number.POSITIVE_INFINITY;
    const relatedBlocks = mainBlocks
      .filter((block) => {
        const top = block.bounds?.top ?? 0;
        return top >= startY && top < nextY && textOf(block) !== heading.text;
      })
      .map((block) => textOf(block))
      .filter((text, itemIndex, arr) => arr.indexOf(text) === itemIndex)
      .slice(0, 6);
    const relatedLinks = state.links
      .filter((link) => {
        const top = link.bounds?.top ?? 0;
        return link.href && top >= startY && top < nextY && textOf(link);
      })
      .filter((link, itemIndex, arr) => arr.findIndex((other) => other.href === link.href && textOf(other) === textOf(link)) === itemIndex)
      .slice(0, 8);

    return `
      <section id="${id}" class="section">
        <h2>${heading.text}</h2>
        ${relatedBlocks.length ? `<ul class="body-list">${relatedBlocks.map((text) => `<li>${text}</li>`).join("")}</ul>` : ""}
        ${relatedLinks.length ? `<div class="link-grid">${relatedLinks.map(renderLinkCard).join("")}</div>` : ""}
      </section>
    `;
  });

  $("#contentSections").innerHTML = content.join("");
}

function renderLinkCard(link) {
  const host = new URL(link.href, state.snapshot.page.origin).hostname;
  return `<a class="link-card" href="${link.href}"><strong>${textOf(link)}</strong><span>${host}</span></a>`;
}

function renderFacts() {
  const { page, viewport, content, collectedAt } = state.snapshot;
  $("#pageFacts").innerHTML = `
    <dt>Title</dt><dd>${page.title}</dd>
    <dt>Language</dt><dd>${page.language || "unknown"}</dd>
    <dt>Collected</dt><dd>${collectedAt}</dd>
    <dt>Viewport</dt><dd>${viewport.width} x ${viewport.height}</dd>
    <dt>Extracted</dt><dd>${content.headings.length} headings, ${content.links.length} links, ${content.forms.length} form</dd>
  `;
}

function renderFooter() {
  const footerTexts = ["버그 신고", "공개된 문제 보기", "Chromium 업데이트", "우수사례", "보관처리", "팟캐스트 및 프로그램", "X의 @ChromiumDev", "YouTube", "LinkedIn의 개발자용 Chrome", "RSS", "약관", "개인정보처리방침"];
  const links = uniqueByText(state.links).filter((link) => footerTexts.includes(textOf(link)));
  $("#footerLinks").className = "footer-links";
  $("#footerLinks").innerHTML = links.map((link) => `<a href="${link.href}">${textOf(link)}</a>`).join("");
}

function renderCookieBar() {
  const region = state.snapshot.content.interactiveElements.find((item) => item.snapshotId === "interactive-2");
  const learn = state.links.find((link) => textOf(link) === "자세히 알아보세요");
  if (!region) return;
  $("#cookieText").textContent = region.label || region.text;
  if (learn) $("#cookieLearn").href = learn.href;
  if (!localStorage.getItem("chromeDocCookieChoice")) $("#cookieBar").hidden = false;
}

function setupSearch() {
  const searchInput = $("#searchInput");
  const results = $("#searchResults");
  function runSearch(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      results.textContent = "검색어를 입력하면 스냅샷의 링크와 제목을 필터링합니다.";
      return;
    }
    const matches = [
      ...state.headings.filter((item) => textOf(item).toLowerCase().includes(normalized)).map((item) => ({ text: textOf(item), href: `#${slug(textOf(item), 0)}` })),
      ...state.links.filter((item) => textOf(item).toLowerCase().includes(normalized)),
    ].slice(0, 10);
    results.innerHTML = matches.length
      ? matches.map((item) => `<a class="search-result" href="${item.href || "#"}">${item.text}</a>`).join("")
      : "스냅샷 데이터에서 일치하는 항목이 없습니다.";
  }
  searchInput.addEventListener("input", () => runSearch(searchInput.value));
  $("#searchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    runSearch(searchInput.value);
    showToast("스냅샷 데이터에서 검색했습니다.");
  });
}

function setupActions() {
  $("#snapshotToggle").addEventListener("click", () => {
    $("#snapshotPanel").hidden = false;
    $("#snapshotPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.addEventListener("click", (event) => {
    const action = event.target?.dataset?.action;
    if (action === "hide-snapshot") $("#snapshotPanel").hidden = true;
    if (action === "accept-cookie" || action === "dismiss-cookie") {
      localStorage.setItem("chromeDocCookieChoice", action);
      $("#cookieBar").hidden = true;
      showToast(action === "accept-cookie" ? "동의함" : "나중에");
    }
  });
}

async function init() {
  const response = await fetch(SNAPSHOT_URL);
  state.snapshot = await response.json();
  state.links = state.snapshot.content.links || [];
  state.headings = state.snapshot.content.headings || [];
  state.textBlocks = state.snapshot.content.textBlocks || [];

  if (state.snapshot.visualSnapshot?.dataUrl) {
    $("#snapshotImage").src = state.snapshot.visualSnapshot.dataUrl;
  } else {
    $("#snapshotToggle").hidden = true;
  }

  document.title = `${state.snapshot.page.title} - simplified`;
  renderNav();
  renderArticle();
  renderFacts();
  renderFooter();
  renderCookieBar();
  setupSearch();
  setupActions();
}

init().catch((error) => {
  $("#pageTitle").textContent = "Snapshot could not be loaded";
  $("#intro").textContent = error.message;
});
