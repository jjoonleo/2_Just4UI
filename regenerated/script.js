const SOURCE_URL = new URL("../downloaded_json/coupang%20galaxy%20phone.json", location.href).href;

const app = document.getElementById("app");
const toast = document.getElementById("toast");
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");

const state = {
  model: null,
  imageIndex: 0,
  quantity: 1,
  cartCount: 0,
  insurance: "선택안함",
  filter: ""
};

document.addEventListener("DOMContentLoaded", init);
document.addEventListener("submit", onSubmit);
document.addEventListener("click", onClick);
document.addEventListener("input", onInput);
document.addEventListener("change", onChange);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

async function init() {
  try {
    const response = await fetch(SOURCE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.model = createModel(await response.json());
    render();
  } catch (error) {
    app.innerHTML = `
      <main class="error-shell">
        <p class="error-title">Snapshot could not be loaded.</p>
        <p class="error-detail">${esc(error.message)}</p>
        <p class="error-detail">Serve the repository root, then open /regenerated/.</p>
      </main>
    `;
  }
}

function createModel(snapshot) {
  const content = snapshot.content || {};
  const links = content.links || [];
  const images = content.images || [];
  const text = content.textBlocks || [];
  const headings = content.headings || [];
  const controls = content.interactiveElements || [];
  const forms = content.forms || [];
  const landmarks = content.landmarks || [];
  const mainText = landmarks.find((item) => item.role === "main")?.textPreview || "";
  const title = headings.find((item) => item.level === 1)?.text || snapshot.page?.title || "Product";
  const brand = links.find((item) => has(item.text, "브랜드샵"));
  const review = links.find((item) => item.href?.includes("sdpReview"));
  const searchField = forms.flatMap((form) => form.fields || []).find((field) => field.name === "q") || {};
  const category = forms.flatMap((form) => form.fields || []).find((field) => field.tag === "select");

  return {
    snapshot,
    page: snapshot.page || {},
    viewport: snapshot.viewport || {},
    links,
    images,
    header: {
      logo: images.find((item) => item.alt === "Coupang"),
      topLinks: unique(links.filter((item) => item.text && y(item) <= 40)).slice(0, 6),
      navLinks: unique(links.filter((item) => item.text && yBetween(item, 112, 158))).slice(0, 18),
      breadcrumbs: unique(links.filter((item) => item.text && yBetween(item, 158, 195))).slice(0, 8),
      searchName: searchField.name || "q",
      searchPlaceholder: searchField.placeholder || "찾고 싶은 상품을 검색해보세요!",
      categories: (category?.options || []).map((item) => item.text).filter(Boolean)
    },
    product: {
      title,
      brandName: brand?.text || "삼성전자 브랜드샵",
      brandHref: brand?.href || snapshot.page?.origin || "#",
      brandLogo: images.find((item) => item.src?.includes("brandLogo")),
      rating: text.find((item) => yBetween(item, 270, 305) && /^\d(?:\.\d)?$/.test(item.text || ""))?.text || "5",
      reviewText: review?.text || "(4,878)",
      proof: text.find((item) => yBetween(item, 270, 312) && item.tag === "p")?.text || "",
      price: parsePrice(mainText),
      delivery: parseDelivery(mainText),
      images: productImages(images, title),
      insurance: controls.filter((item) => item.type === "radio" && item.label).sort((a, b) => (a.bounds?.x || 0) - (b.bounds?.x || 0)).map((item) => item.label),
      specs: text.filter((item) => item.tag === "li" && yBetween(item, 880, 1015)).map((item) => item.text),
      originalUrl: snapshot.page?.url || snapshot.page?.canonicalUrl || "#"
    },
    cards: {
      recommendations: cardsFrom(links, images, 1210, 1560, 24),
      deals: cardsFrom(links, images, 1680, 2090, 18),
      boughtTogether: cardsFrom(links, images, 20170, 20470, 15),
      brandProducts: cardsFrom(links, images, 20590, 20840, 5),
      related: cardsFrom(links, images, 20980, 21620, 18)
    },
    qna: text.filter((item) => item.tag === "li" && yBetween(item, 17540, 17670)).map((item) => item.text),
    policy: {
      delivery: keyValues(text, 18720, 18905),
      returns: keyValues(text, 18940, 19190),
      limits: text.filter((item) => ["li", "p"].includes(item.tag) && yBetween(item, 19270, 19620)).map((item) => item.text).slice(0, 9)
    },
    counts: {
      links: links.length,
      images: images.length,
      controls: controls.length,
      text: text.length
    }
  };
}

function render() {
  const model = state.model;
  const image = model.product.images[state.imageIndex] || model.product.images[0] || {};
  document.title = `Regenerated - ${model.product.title}`;
  app.innerHTML = `
    ${header(model)}
    ${breadcrumbs(model.header.breadcrumbs)}
    <main class="page">
      <section class="hero" id="top">
        <div class="gallery">
          <div class="thumb-list">
            ${model.product.images.map((item, index) => `
              <button class="thumb-button ${index === state.imageIndex ? "is-active" : ""}" type="button" data-action="image" data-index="${index}" aria-label="Product image ${index + 1}">
                <img src="${at(item.thumb)}" alt="${at(item.alt)}" loading="lazy">
              </button>
            `).join("")}
          </div>
          <button class="main-image-button" type="button" data-action="zoom" aria-label="Open product image">
            <img src="${at(image.full)}" alt="${at(image.alt || model.product.title)}">
          </button>
        </div>
        ${productInfo(model.product)}
      </section>
      ${tabs()}
      ${details(model)}
      ${cardSection("recommendations", "다른 고객이 함께 본 상품", model.cards.recommendations, true)}
      ${cardSection("deals", "특가진행중", model.cards.deals)}
      ${reviews(model)}
      ${qna(model)}
      ${policies(model)}
      ${cardSection("boughtTogether", "다른 고객이 함께 구매한 상품", model.cards.boughtTogether)}
      ${cardSection("brandProducts", "삼성전자의 다른 상품들", model.cards.brandProducts)}
      ${cardSection("related", "고르고 골랐어요", model.cards.related)}
    </main>
    ${footer(model)}
  `;
  updateStatefulElements();
  applyFilter(false);
  observeTabs();
}

function header(model) {
  const logo = model.header.logo
    ? `<img src="${at(model.header.logo.src)}" alt="${at(model.header.logo.alt || "Coupang")}">`
    : `<span class="brand-logo-fallback">Coupang</span>`;
  return `
    <header class="site-header">
      <div class="top-strip">
        <div class="top-strip-inner">
          <ul class="quick-links">
            <li><a href="${at(model.page.origin || "#")}" target="_blank" rel="noopener">즐겨찾기</a></li>
            <li><a href="${at(model.product.brandHref)}" target="_blank" rel="noopener">입점신청</a></li>
          </ul>
          <ul class="top-links">${model.header.topLinks.map(linkItem).join("")}</ul>
        </div>
      </div>
      <div class="header-main">
        <a class="brand-logo" href="${at(model.page.origin || "#")}" target="_blank" rel="noopener">${logo}</a>
        <form class="search-form">
          <select aria-label="Search category">${(model.header.categories.length ? model.header.categories : ["전체"]).map((item) => `<option>${esc(item)}</option>`).join("")}</select>
          <input id="searchInput" type="search" name="${at(model.header.searchName)}" placeholder="${at(model.header.searchPlaceholder)}" value="${at(state.filter)}">
          <button type="submit" aria-label="검색">Search</button>
        </form>
        <div class="header-actions">
          <a class="header-action" href="${at(findHref(model.header.topLinks, "로그인"))}" target="_blank" rel="noopener">로그인</a>
          <a class="header-action" href="${at(findHref(model.header.topLinks, "회원가입"))}" target="_blank" rel="noopener">회원가입</a>
          <button class="header-action" type="button" data-action="cart">장바구니<span id="cartCount" class="cart-badge">0</span></button>
        </div>
      </div>
      <nav class="nav-row" aria-label="Main navigation">
        <ul class="nav-list">${model.header.navLinks.map(linkItem).join("")}</ul>
      </nav>
    </header>
  `;
}

function breadcrumbs(items) {
  if (!items.length) return "";
  return `<div class="breadcrumb-wrap"><ol class="breadcrumb">${items.map((item) => `<li><a href="${at(item.href || "#")}" target="_blank" rel="noopener">${esc(item.text)}</a></li>`).join("")}</ol></div>`;
}

function productInfo(product) {
  const brandLogo = product.brandLogo ? `<img class="brand-mark" src="${at(product.brandLogo.src)}" alt="">` : "";
  const insurance = (product.insurance.length ? product.insurance : ["선택안함"]).map((item, index) => `
    <label class="insurance-option">
      <input type="radio" name="insurance" value="${at(item)}" ${(state.insurance === item || (!state.insurance && index === 0)) ? "checked" : ""}>
      <span>${esc(item)}</span>
    </label>
  `).join("");
  return `
    <section class="product-info" aria-labelledby="productTitle">
      <a class="brand-row" href="${at(product.brandHref)}" target="_blank" rel="noopener">${brandLogo}<span>${esc(product.brandName)}</span></a>
      <h1 id="productTitle" class="product-title">${esc(product.title)}</h1>
      <div class="rating-row"><span class="stars">★★★★★</span><a class="review-link" href="#reviews">${esc(product.reviewText)}</a></div>
      ${product.proof ? `<p class="proof-row">${esc(product.proof)}</p>` : ""}
      <div class="price-box"><span class="discount">${esc(product.price.discount)}</span><strong class="sale-price">${esc(product.price.sale)}</strong><span class="original-price">${esc(product.price.original)}</span></div>
      <div class="delivery-box"><p class="box-label">배송</p><ul class="delivery-lines">${product.delivery.map((item) => `<li>${esc(item)}</li>`).join("")}</ul><button class="ghost-button" type="button" data-action="sellers">다른 판매자 보기(2)</button></div>
      <div class="insurance-box"><p class="box-label">파손케어</p><div class="insurance-options">${insurance}</div></div>
      <div class="payment-box"><p class="box-label">결제 혜택</p><div class="meta-row"><span>쿠페이머니</span><span>카드</span><span>계좌이체</span><button class="ghost-button" type="button" data-action="cashback">쿠팡캐시 적립</button></div></div>
      <div class="purchase-row">
        <div class="quantity-control"><button type="button" data-action="qty-minus" aria-label="수량빼기">-</button><input id="quantityInput" inputmode="numeric" value="${state.quantity}" aria-label="수량"><button type="button" data-action="qty-plus" aria-label="수량더하기">+</button></div>
        <button class="secondary-button" type="button" data-action="add-cart">장바구니 담기</button>
        <button class="primary-button" type="button" data-action="buy">바로구매</button>
      </div>
      <div class="mini-actions"><a class="ghost-button" href="${at(product.originalUrl)}" target="_blank" rel="noopener">원본 페이지</a><button class="ghost-button" type="button" data-action="share">공유</button></div>
      <div class="spec-box"><p class="box-label">상품 정보</p><ul class="spec-list">${product.specs.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>
    </section>
  `;
}

function tabs() {
  return `
    <nav class="sticky-tabs" aria-label="Product sections"><div class="sticky-tabs-inner">
      <a class="tab-link" href="#details">상품정보</a>
      <a class="tab-link" href="#recommendations">추천상품</a>
      <a class="tab-link" href="#reviews">상품리뷰</a>
      <a class="tab-link" href="#qna">상품문의</a>
      <a class="tab-link" href="#policies">배송/교환</a>
    </div></nav>
  `;
}

function details(model) {
  return `
    <section id="details" class="content-section">
      <div class="section-header"><div><h2 class="section-title">상품정보</h2><p class="section-meta">${esc(model.page.metaDescription || model.page.title || "")}</p></div></div>
      <div class="snapshot-grid">
        <div class="snapshot-stat"><strong>${model.counts.links}</strong><span>links retained</span></div>
        <div class="snapshot-stat"><strong>${model.counts.images}</strong><span>images retained</span></div>
        <div class="snapshot-stat"><strong>${model.counts.controls}</strong><span>controls mapped</span></div>
        <div class="snapshot-stat"><strong>${Number(model.viewport.documentHeight || 0).toLocaleString()}</strong><span>source page height</span></div>
      </div>
    </section>
  `;
}

function cardSection(id, title, cards, filter = false) {
  if (!cards.length) return "";
  const tools = filter
    ? `<div class="filter-row"><input id="cardFilter" type="search" value="${at(state.filter)}" placeholder="상품명으로 필터"><button class="ghost-button" type="button" data-action="clear-filter">Clear</button></div>`
    : `<p class="section-meta">${cards.length} items</p>`;
  return `
    <section id="${at(id)}" class="content-section">
      <div class="section-header"><h2 class="section-title">${esc(title)}</h2>${tools}</div>
      <div class="card-scroller">${cards.map(card).join("")}</div>
    </section>
  `;
}

function card(item) {
  const image = item.image ? `<img class="card-image" src="${at(item.image)}" alt="${at(item.title)}" loading="lazy">` : `<div class="card-image"></div>`;
  return `
    <a class="product-card" href="${at(item.href)}" target="_blank" rel="noopener" data-card-text="${at(item.searchText)}">
      ${image}
      ${item.deal ? `<span class="deal-badge">특가</span>` : ""}
      <span class="card-title">${esc(item.title)}</span>
      ${item.price ? `<span class="card-price">${esc(item.price)}</span>` : ""}
      ${item.sub ? `<span class="card-sub">${esc(item.sub)}</span>` : ""}
    </a>
  `;
}

function reviews(model) {
  return `
    <section id="reviews" class="content-section">
      <div class="section-header"><h2 class="section-title">상품 리뷰</h2><p class="section-meta">${esc(model.product.reviewText.replace(/[()]/g, ""))} reviews from source snapshot</p></div>
      <div class="review-summary"><h3>${esc(model.product.rating)} / 5</h3><div class="stars">★★★★★</div><div class="review-bars">${bar("5점", 88)}${bar("4점", 8)}${bar("3점", 3)}${bar("2점", 1)}${bar("1점", 0)}</div></div>
    </section>
  `;
}

function bar(label, value) {
  return `<div class="review-bar"><span>${esc(label)}</span><span class="bar-track"><span class="bar-fill" style="width:${value}%"></span></span><span>${value}%</span></div>`;
}

function qna(model) {
  return `<section id="qna" class="content-section"><div class="section-header"><h2 class="section-title">상품문의</h2><button class="ghost-button" type="button" data-action="question">문의하기</button></div><ul class="question-list">${model.qna.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></section>`;
}

function policies(model) {
  return `
    <section id="policies" class="content-section">
      <div class="section-header"><h2 class="section-title">배송/교환/반품</h2></div>
      <div class="policy-grid">
        <article class="policy-card"><h3>배송정보</h3>${kv(model.policy.delivery)}</article>
        <article class="policy-card"><h3>교환/반품 안내</h3>${kv(model.policy.returns)}</article>
      </div>
      <div class="details-list" style="margin-top:14px"><details><summary>교환/반품 제한사항</summary><div class="details-body"><ul class="policy-list">${model.policy.limits.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div></details></div>
    </section>
  `;
}

function footer(model) {
  return `<footer class="footer"><div class="footer-inner"><span>${esc(model.page.title || "")}</span><a href="${at(model.page.canonicalUrl || model.page.url || "#")}" target="_blank" rel="noopener">Canonical URL</a><span>Collected ${esc(model.snapshot.collectedAt || "")}</span></div></footer>`;
}

function onSubmit(event) {
  if (!event.target.matches(".search-form")) return;
  event.preventDefault();
  state.filter = document.getElementById("searchInput")?.value.trim() || "";
  syncFilters();
  applyFilter();
  document.getElementById("recommendations")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function onInput(event) {
  if (event.target.id === "quantityInput") {
    state.quantity = clampQuantity(event.target.value);
    updateStatefulElements();
  }
  if (event.target.id === "searchInput" || event.target.id === "cardFilter") {
    state.filter = event.target.value.trim();
    syncFilters(event.target.id);
    if (event.target.id === "cardFilter") applyFilter();
  }
}

function onChange(event) {
  if (event.target.name === "insurance") {
    state.insurance = event.target.value;
    showToast(`${event.target.value} 선택됨`);
  }
}

function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "image") {
    state.imageIndex = Number(button.dataset.index || 0);
    render();
  }
  if (action === "zoom") {
    const product = state.model.product;
    const image = product.images[state.imageIndex] || product.images[0];
    openModal(product.title, `<img src="${at(image?.full || "")}" alt="${at(image?.alt || product.title)}">`);
  }
  if (action === "qty-plus") state.quantity += 1;
  if (action === "qty-minus") state.quantity = Math.max(1, state.quantity - 1);
  if (action === "qty-plus" || action === "qty-minus") updateStatefulElements();
  if (action === "add-cart") {
    state.cartCount += state.quantity;
    updateStatefulElements();
    showToast(`${state.quantity}개가 장바구니에 담겼습니다.`);
  }
  if (action === "buy") openOrder();
  if (action === "cart") openCart();
  if (action === "sellers") openSellers();
  if (action === "cashback") openModal("쿠팡캐시 적립", "<p>선택한 결제 수단과 멤버십 조건에 따라 적립 혜택이 적용됩니다.</p>");
  if (action === "question") openModal("문의하기", `<p>로그인 후 원본 상품 페이지에서 상품 문의를 등록할 수 있습니다.</p><p><a class="primary-button" href="${at(state.model.product.originalUrl)}" target="_blank" rel="noopener">원본 페이지 열기</a></p>`);
  if (action === "share") share();
  if (action === "clear-filter") {
    state.filter = "";
    syncFilters();
    applyFilter();
  }
  if (action === "close-modal") closeModal();
}

function openOrder() {
  const product = state.model.product;
  const total = money(product.price.sale) ? won(money(product.price.sale) * state.quantity) : product.price.sale;
  openModal("주문 확인", `
    <div class="order-summary">
      <div class="summary-line"><span>상품</span><strong>${esc(product.title)}</strong></div>
      <div class="summary-line"><span>수량</span><strong>${state.quantity}</strong></div>
      <div class="summary-line"><span>파손케어</span><strong>${esc(state.insurance)}</strong></div>
      <div class="summary-line"><span>상품금액</span><strong class="summary-total">${esc(total)}</strong></div>
      <a class="primary-button" href="${at(product.originalUrl)}" target="_blank" rel="noopener">원본에서 계속</a>
    </div>
  `);
}

function openCart() {
  const body = state.cartCount
    ? `<div class="order-summary"><div class="summary-line"><span>${esc(state.model.product.title)}</span><strong>${state.cartCount}개</strong></div><button class="primary-button" type="button" data-action="buy">바로구매</button></div>`
    : "<p>장바구니가 비어 있습니다.</p>";
  openModal("장바구니", body);
}

function openSellers() {
  const price = state.model.product.price;
  openModal("다른 판매자 보기", `
    <div class="order-summary">
      ${seller("로켓배송", price.sale, "내일 도착 보장")}
      ${seller("일반 판매자", price.original, "5/20 도착 예정")}
    </div>
  `);
}

function share() {
  const url = state.model.product.originalUrl;
  if (!navigator.clipboard) {
    openModal("공유", `<p>${esc(url)}</p>`);
    return;
  }
  navigator.clipboard.writeText(url).then(() => showToast("원본 링크를 복사했습니다."));
}

function updateStatefulElements() {
  const quantity = document.getElementById("quantityInput");
  const cart = document.getElementById("cartCount");
  if (quantity) quantity.value = String(state.quantity);
  if (cart) cart.textContent = String(state.cartCount);
}

function syncFilters(sourceId = "") {
  for (const id of ["searchInput", "cardFilter"]) {
    if (id !== sourceId) {
      const input = document.getElementById(id);
      if (input) input.value = state.filter;
    }
  }
}

function applyFilter(announce = true) {
  const term = norm(state.filter);
  let visible = 0;
  document.querySelectorAll(".product-card").forEach((item) => {
    const show = !term || norm(item.dataset.cardText).includes(term);
    item.hidden = !show;
    if (show) visible += 1;
  });
  if (term && announce) showToast(`${visible}개 상품이 표시됩니다.`);
}

function openModal(title, body) {
  modalTitle.textContent = title;
  modalBody.innerHTML = body;
  modal.hidden = false;
  modal.querySelector(".modal-close")?.focus();
}

function closeModal() {
  modal.hidden = true;
  modalBody.innerHTML = "";
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2200);
}

function observeTabs() {
  const links = [...document.querySelectorAll(".tab-link")];
  const sections = links.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
  const observer = new IntersectionObserver((entries) => {
    const active = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!active) return;
    links.forEach((link) => link.classList.toggle("is-active", link.hash === `#${active.target.id}`));
  }, { rootMargin: "-35% 0px -55% 0px", threshold: [0.01, 0.2, 0.5] });
  sections.forEach((section) => observer.observe(section));
}

function productImages(images, title) {
  const main = images.find((item) => item.alt === "Product image");
  const thumbs = images.filter((item) => (item.bounds?.x || 0) <= 110 && yBetween(item, 190, 660) && (item.bounds?.width || 0) >= 38).sort((a, b) => y(a) - y(b));
  const result = thumbs.map((item, index) => ({
    thumb: item.src,
    full: index === 0 && main?.src ? main.src : item.src.replace("/48x48ex/", "/492x492ex/"),
    alt: `${title} ${index + 1}`
  }));
  if (!result.length && main) result.push({ thumb: main.src, full: main.src, alt: title });
  return result;
}

function cardsFrom(links, images, min, max, limit) {
  return links
    .filter((item) => item.text && item.href?.includes("/vp/products/") && yBetween(item, min, max))
    .sort((a, b) => y(a) - y(b) || (a.bounds?.x || 0) - (b.bounds?.x || 0))
    .slice(0, limit)
    .map((link) => {
      const parsed = parseCard(link.text);
      const image = nearestImage(images, link);
      return { href: link.href, image: image?.src || "", searchText: link.text, deal: /^특가진행중/.test(link.text), ...parsed };
    });
}

function parseCard(value) {
  const text = value.replace(/\s+/g, " ").trim();
  const clean = text.replace(/^특가진행중\s*/, "");
  const delivery = clean.match(/(내일\([^)]+\)\s*도착 보장|무료배송|5\/\d+\([^)]+\)\s*도착 예정)/)?.[0] || "";
  const review = clean.match(/\(([\d,]+)\)(?!.*\([\d,]+\))/)?.[0] || "";
  const regionEnd = firstIndex(clean, [/\s무료배송\s/, /\s내일\(/, /\s5\/\d+/]);
  const priceRegion = regionEnd > 12 ? clean.slice(0, regionEnd) : clean;
  const priceMatches = [...priceRegion.matchAll(/\d{1,3}(?:,\d{3})+원/g)];
  const loosePriceMatches = [...priceRegion.matchAll(/\d{1,3}(?:,\d{3})+(?![.\d])/g)];
  const price = priceMatches.at(-1)?.[0] || (loosePriceMatches.at(-1)?.[0] ? `${loosePriceMatches.at(-1)[0]}원` : "");
  const titleEnd = firstIndex(clean, [/\s할인\s/, /\s쿠폰할인\s/, /\s와우할인\s/, /\s\d{1,3}(?:,\d{3})+(?:원)?\s/, /\s무료배송\s/, /\s내일\(/, /\s5\/\d+/]);
  return {
    title: (titleEnd > 12 ? clean.slice(0, titleEnd) : clean).trim(),
    price,
    sub: [delivery, review].filter(Boolean).join(" ")
  };
}

function nearestImage(images, link) {
  return images
    .filter((image) => (image.bounds?.width || 0) >= 100 && (image.bounds?.height || 0) >= 100 && Math.abs(y(image) - y(link)) <= 32)
    .sort((a, b) => Math.abs((a.bounds?.x || 0) - (link.bounds?.x || 0)) - Math.abs((b.bounds?.x || 0) - (link.bounds?.x || 0)))[0];
}

function keyValues(text, min, max) {
  const rows = new Map();
  text.filter((item) => ["th", "td"].includes(item.tag) && yBetween(item, min, max)).forEach((item) => {
    const key = Math.round(y(item));
    rows.set(key, [...(rows.get(key) || []), item]);
  });
  return [...rows.values()].map((cells) => {
    const sorted = cells.sort((a, b) => (a.bounds?.x || 0) - (b.bounds?.x || 0));
    return {
      key: sorted.find((item) => item.tag === "th")?.text || "",
      value: sorted.find((item) => item.tag === "td")?.text || ""
    };
  }).filter((item) => item.key && item.value);
}

function kv(items) {
  return items.length ? items.map((item) => `<p><strong>${esc(item.key)}</strong></p><p>${esc(item.value)}</p>`).join("") : `<p class="section-meta">No rows captured.</p>`;
}

function parsePrice(text) {
  const match = text.match(/(\d+%)\s+([\d,]+원)\s+([\d,]+원)/);
  return { discount: match?.[1] || "19%", sale: match?.[2] || "1,643,000원", original: match?.[3] || "2,050,400원" };
}

function parseDelivery(text) {
  const lines = [];
  const first = text.match(/이 상품은\s+내일 도착,\s*무료배송/);
  const second = text.match(/내일\([^)]+\)\s+\d+\/\d+\s+도착 보장\s+\([^)]+\)/);
  if (first) lines.push(first[0]);
  if (second) lines.push(second[0]);
  return lines.length ? [...new Set(lines)] : ["내일(일) 도착 보장", "무료배송"];
}

function linkItem(item) {
  return `<li><a href="${at(item.href || "#")}" target="_blank" rel="noopener">${esc(item.text)}</a></li>`;
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.text}|${item.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => y(a) - y(b) || (a.bounds?.x || 0) - (b.bounds?.x || 0));
}

function firstIndex(text, patterns) {
  const indexes = patterns.map((pattern) => text.match(pattern)?.index ?? -1).filter((index) => index > 12);
  return indexes.length ? Math.min(...indexes) : -1;
}

function findHref(links, text) {
  return links.find((item) => has(item.text, text))?.href || "#";
}

function seller(name, price, delivery) {
  return `<div class="summary-line"><span>${esc(name)}<br><small>${esc(delivery)}</small></span><strong>${esc(price)}</strong></div>`;
}

function y(item) {
  return item.bounds?.y ?? item.bounds?.top ?? 0;
}

function yBetween(item, min, max) {
  const value = y(item);
  return value >= min && value < max;
}

function has(value, needle) {
  return String(value || "").includes(needle);
}

function clampQuantity(value) {
  const parsed = Number.parseInt(String(value).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 99) : 1;
}

function money(value) {
  const parsed = Number.parseInt(String(value || "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function won(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

function norm(value) {
  return String(value || "").trim().toLocaleLowerCase("ko-KR");
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

function at(value) {
  return esc(value).replace(/`/g, "&#96;");
}
