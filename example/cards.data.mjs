// Card content and timing — shared by every theme build.
// The markup uses generic class names (.kicker/.title/.detail/.stat/...) so a
// theme only has to ship a different stylesheet, not different HTML.

// ── text splitting ────────────────────────────────────────────────────────
// Vietnamese headlines are split per WORD, never per code point: the
// vietnamese subset carries combining marks (U+0300-0309, U+0323), so a naive
// per-character split would tear a diacritic off its base letter.
const words = (s) =>
  s
    .split(" ")
    .map((w) => `<span class="char">${w}</span>`)
    .join(" ");

// Per-grapheme, for short ASCII tokens (numbers, latin product names) where a
// tighter stagger reads better. Intl.Segmenter keeps any mark with its base.
const graphemes = (s) =>
  [...new Intl.Segmenter("vi", { granularity: "grapheme" }).segment(s.normalize("NFC"))]
    .map((g) => `<span class="char">${g.segment === " " ? "&nbsp;" : g.segment}</span>`)
    .join("");

// ── cards ─────────────────────────────────────────────────────────────────
// Each: id, start, end, acc (accent index), opaque (PiP-era paper cards),
// html, and anims (compiled to GSAP below; `t` is relative to `start`).
const CARDS = [
  {
    id: "card-01",
    start: 0.45,
    end: 5.45,
    acc: 0,
    html: `
      <div class="wrap lower">
        <div id="card-01-kicker" class="kicker">MINI PC</div>
        <div class="statrow">
          <div id="card-01-stat" class="stat">4</div>
          <div class="statside">
            <div id="card-01-rule" class="rule"></div>
            <div id="card-01-label" class="statlabel">MODEL AI<br />CHẠY CÙNG LÚC</div>
          </div>
        </div>
        <p id="card-01-detail" class="detail">và vẫn chưa dùng hết <b>một nửa</b> bộ nhớ</p>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-01-kicker", kind: "maskLeft", d: 0.45 },
      { t: 0.35, sel: "#card-01-stat", kind: "pop", d: 0.6 },
      { t: 0.7, sel: "#card-01-rule", kind: "growX", w: 300, d: 0.45 },
      { t: 0.85, sel: "#card-01-label", kind: "fadeUp", d: 0.5 },
      { t: 1.3, sel: "#card-01-detail", kind: "fadeUp", d: 0.5 },
    ],
  },
  {
    id: "card-02",
    start: 5.65,
    end: 13.4,
    acc: 1,
    html: `
      <div class="wrap lower">
        <div id="card-02-kicker" class="kicker">THIẾT BỊ</div>
        <h1 id="card-02-title" class="title">${words("GIGABYTE AI TOP ATOM")}</h1>
        <div id="card-02-rule" class="rule"></div>
        <div class="chips">
          <span id="card-02-chip1" class="chip">128GB UNIFIED MEMORY</span>
          <span id="card-02-chip2" class="chip">NVIDIA GB10</span>
        </div>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-02-kicker", kind: "maskLeft", d: 0.45 },
      { t: 0.4, sel: "#card-02-title", kind: "chars", d: 0.55, stagger: 0.07 },
      { t: 1.1, sel: "#card-02-rule", kind: "growX", w: 420, d: 0.5 },
      { t: 2.1, sel: "#card-02-chip1", kind: "pop", d: 0.45 },
      { t: 4.5, sel: "#card-02-chip2", kind: "pop", d: 0.45 },
    ],
  },
  {
    id: "card-03",
    start: 13.45,
    end: 17.4,
    acc: 2,
    html: `
      <div class="wrap lower">
        <div id="card-03-kicker" class="kicker">CÂU HỎI</div>
        <h1 id="card-03-title" class="title">${words("128GB hữu ích tới đâu?")}</h1>
        <p id="card-03-detail" class="detail">khi build một <b>AI workflow hoàn chỉnh</b></p>
      </div>`,
    anims: [
      { t: 0.1, sel: "#card-03-kicker", kind: "maskLeft", d: 0.4 },
      { t: 0.3, sel: "#card-03-title", kind: "chars", d: 0.5, stagger: 0.07 },
      { t: 1.2, sel: "#card-03-detail", kind: "fadeUp", d: 0.5 },
    ],
  },
  {
    id: "card-04",
    start: 17.5,
    end: 26.0,
    acc: 3,
    html: `
      <div class="wrap lower">
        <div class="specline"><span id="card-04-l1k" class="tag">FORM FACTOR</span><span id="card-04-l1" class="specval">nhỏ như một mini PC</span></div>
        <div class="specline"><span id="card-04-l2k" class="tag">CẤU HÌNH</span><span id="card-04-l2" class="specval">khá khủng</span></div>
        <div id="card-04-reveal" class="revealbox">
          <div class="revealsmall">nên gọi đúng hơn là</div>
          <div id="card-04-big" class="revealbig">${words("mini AI WORKSTATION")}</div>
        </div>
      </div>`,
    anims: [
      { t: 0.2, sel: "#card-04-l1k", kind: "maskLeft", d: 0.4 },
      { t: 0.4, sel: "#card-04-l1", kind: "fadeUp", d: 0.45 },
      { t: 1.9, sel: "#card-04-l2k", kind: "maskLeft", d: 0.4 },
      { t: 2.1, sel: "#card-04-l2", kind: "fadeUp", d: 0.45 },
      { t: 4.15, sel: "#card-04-reveal", kind: "pop", d: 0.5 },
      { t: 4.45, sel: "#card-04-big", kind: "chars", d: 0.5, stagger: 0.08 },
    ],
  },
  {
    id: "card-05",
    start: 26.05,
    end: 32.0,
    acc: 1,
    html: `
      <div class="wrap lower">
        <div id="card-05-kicker" class="kicker">MỞ KHOÁ</div>
        <h1 id="card-05-title" class="title">${words("LLM > 100 tỷ tham số")}</h1>
        <div id="card-05-rule" class="rule"></div>
        <div class="chips"><span id="card-05-chip" class="chip">GPT-OSS 120B</span></div>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-05-kicker", kind: "maskLeft", d: 0.4 },
      { t: 0.35, sel: "#card-05-title", kind: "chars", d: 0.5, stagger: 0.06 },
      { t: 1.1, sel: "#card-05-rule", kind: "growX", w: 380, d: 0.45 },
      { t: 3.3, sel: "#card-05-chip", kind: "pop", d: 0.45 },
    ],
  },
  {
    id: "card-06",
    start: 32.05,
    end: 38.2,
    acc: 0,
    html: `
      <div class="wrap lower">
        <div id="card-06-kicker" class="kicker">USE CASE THỰC TẾ HƠN</div>
        <h1 id="card-06-title" class="title">${words("Nhiều model cùng lúc")}</h1>
        <p id="card-06-detail" class="detail">trong <b>một</b> AI workflow</p>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-06-kicker", kind: "maskLeft", d: 0.45 },
      { t: 1.1, sel: "#card-06-title", kind: "chars", d: 0.5, stagger: 0.07 },
      { t: 2.0, sel: "#card-06-detail", kind: "fadeUp", d: 0.5 },
    ],
  },
  {
    id: "card-07",
    start: 38.4,
    end: 44.0,
    acc: 4,
    html: `
      <div class="wrap lower">
        <div id="card-07-kicker" class="kicker">BUILD THỬ</div>
        <h1 id="card-07-title" class="title">${words("Multimodal RAG")}</h1>
        <div id="card-07-rule" class="rule"></div>
        <p id="card-07-detail" class="detail">hỏi đáp trên một folder tài liệu <b>PDF</b></p>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-07-kicker", kind: "maskLeft", d: 0.4 },
      { t: 0.5, sel: "#card-07-title", kind: "chars", d: 0.55, stagger: 0.08 },
      { t: 1.2, sel: "#card-07-rule", kind: "growX", w: 360, d: 0.45 },
      { t: 1.9, sel: "#card-07-detail", kind: "fadeUp", d: 0.5 },
    ],
  },
  {
    id: "card-08",
    start: 44.05,
    end: 47.45,
    acc: 2,
    html: `
      <div class="wrap lower">
        <div id="card-08-badge" class="badge">${graphemes("100% LOCAL")}</div>
        <p id="card-08-detail" class="detail">không gọi ra cloud</p>
      </div>`,
    anims: [
      { t: 0.2, sel: "#card-08-badge", kind: "pop", d: 0.5 },
      { t: 0.35, sel: "#card-08-badge", kind: "chars", d: 0.4, stagger: 0.035 },
      { t: 0.9, sel: "#card-08-detail", kind: "fadeUp", d: 0.45 },
    ],
  },
  {
    id: "card-09",
    start: 47.55,
    end: 62.4,
    acc: 1,
    html: `
      <div class="wrap lower">
        <div id="card-09-kicker" class="kicker">PIPELINE</div>
        <div class="rows">
          <div id="card-09-r1" class="row"><span class="rownum">01</span><span class="rowbody"><b class="rowmodel">Qwen2.5-VL-7B</b><span class="rowrole">đọc hình ảnh, biểu đồ &amp; nội dung PDF</span></span></div>
          <div id="card-09-r2" class="row"><span class="rownum">02</span><span class="rowbody"><b class="rowmodel">BGE-M3</b><span class="rowrole">embedding &amp; tìm đoạn liên quan</span></span></div>
          <div id="card-09-r3" class="row"><span class="rownum">03</span><span class="rowbody"><b class="rowmodel">BGE-Reranker-v2-M3</b><span class="rowrole">lọc lại kết quả</span></span></div>
          <div id="card-09-r4" class="row"><span class="rownum">04</span><span class="rowbody"><b class="rowmodel">Qwen2.5-32B</b><span class="rowrole">reasoning &amp; trả lời câu hỏi</span></span></div>
        </div>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-09-kicker", kind: "maskLeft", d: 0.4 },
      { t: 0.35, sel: "#card-09-r1", kind: "slideLeft", d: 0.5 },
      { t: 4.65, sel: "#card-09-r2", kind: "slideLeft", d: 0.5 },
      { t: 7.0, sel: "#card-09-r3", kind: "slideLeft", d: 0.5 },
      { t: 9.6, sel: "#card-09-r4", kind: "slideLeft", d: 0.5 },
    ],
  },
  {
    id: "card-10",
    start: 63.3,
    end: 68.2,
    acc: 0,
    opaque: true,
    html: `
      <div class="wrap paper">
        <div id="card-10-kicker" class="kicker">CÙNG LÚC</div>
        <div class="statrow">
          <div id="card-10-stat" class="stat">4</div>
          <div class="statside">
            <div id="card-10-rule" class="rule"></div>
            <div id="card-10-label" class="statlabel">MODEL<br />TRONG MEMORY</div>
          </div>
        </div>
        <p id="card-10-detail" class="detail">mỗi model đảm nhiệm một phần riêng của pipeline</p>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-10-kicker", kind: "maskLeft", d: 0.4 },
      { t: 0.35, sel: "#card-10-stat", kind: "pop", d: 0.6 },
      { t: 0.7, sel: "#card-10-rule", kind: "growX", w: 300, d: 0.45 },
      { t: 0.85, sel: "#card-10-label", kind: "fadeUp", d: 0.5 },
      { t: 1.6, sel: "#card-10-detail", kind: "fadeUp", d: 0.5 },
    ],
  },
  {
    id: "card-11",
    start: 68.4,
    end: 73.95,
    acc: 2,
    opaque: true,
    html: `
      <div class="wrap paper">
        <div id="card-11-kicker" class="kicker">PEAK MEMORY</div>
        <div class="bigmetric">
          <span id="card-11-val" class="bignum">0</span><span class="bigunit">GB</span>
        </div>
        <div class="bar"><div id="card-11-bar" class="barfill"></div></div>
        <div class="barmeta"><span id="card-11-meta">trên <b>121.6GB</b> usable memory</span></div>
        <p id="card-11-detail" class="detail">toàn bộ workflow chạy đồng thời</p>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-11-kicker", kind: "maskLeft", d: 0.4 },
      { t: 0.4, sel: "#card-11-val", kind: "countUp", from: 0, to: 66, fmt: ".0f", d: 1.1 },
      { t: 0.4, sel: "#card-11-bar", kind: "growX", w: 500, d: 1.1 },
      { t: 1.5, sel: "#card-11-meta", kind: "fadeUp", d: 0.45 },
      { t: 2.0, sel: "#card-11-detail", kind: "fadeUp", d: 0.45 },
    ],
  },
  {
    id: "card-12",
    start: 74.05,
    end: 85.5,
    acc: 1,
    opaque: true,
    html: `
      <div class="wrap paper">
        <div id="card-12-kicker" class="kicker">ĐỘ TRỄ</div>
        <p id="card-12-lead" class="detail">một query từ lúc gửi vào tới khi pipeline xử lý xong</p>
        <div id="card-12-m1" class="metric">
          <div class="metricval"><span id="card-12-v1" class="bignum">0.0</span><span class="bigunit">giây</span></div>
          <div class="metriclabel">trung bình, end-to-end</div>
        </div>
        <div id="card-12-m2" class="metric alt">
          <div class="metricval"><span id="card-12-v2" class="bignum sm">0.0</span><span class="bigunit">giây</span></div>
          <div class="metriclabel">time-to-first-token</div>
        </div>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-12-kicker", kind: "maskLeft", d: 0.4 },
      { t: 0.4, sel: "#card-12-lead", kind: "fadeUp", d: 0.5 },
      { t: 5.0, sel: "#card-12-m1", kind: "slideLeft", d: 0.5 },
      { t: 5.2, sel: "#card-12-v1", kind: "countUp", from: 0, to: 2.2, fmt: ".1f", d: 0.9 },
      { t: 7.1, sel: "#card-12-m2", kind: "slideLeft", d: 0.5 },
      { t: 7.3, sel: "#card-12-v2", kind: "countUp", from: 0, to: 1.2, fmt: ".1f", d: 0.8 },
    ],
  },
  {
    id: "card-13",
    start: 85.6,
    end: 89.0,
    acc: 3,
    opaque: true,
    html: `
      <div class="wrap paper">
        <div id="card-13-kicker" class="kicker">QWEN2.5-32B</div>
        <div class="bigmetric">
          <span id="card-13-val" class="bignum">0.0</span><span class="bigunit">token/s</span>
        </div>
        <p id="card-13-detail" class="detail">tốc độ generate</p>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-13-kicker", kind: "maskLeft", d: 0.4 },
      { t: 0.85, sel: "#card-13-val", kind: "countUp", from: 0, to: 8.3, fmt: ".1f", d: 0.9 },
      { t: 1.4, sel: "#card-13-detail", kind: "fadeUp", d: 0.45 },
    ],
  },
  {
    id: "card-14",
    start: 89.05,
    end: 91.6,
    acc: 4,
    opaque: true,
    html: `
      <div class="wrap paper">
        <div id="card-14-kicker" class="kicker">THROUGHPUT</div>
        <div class="bigmetric">
          <span id="card-14-val" class="bignum">0.0</span><span class="bigunit">query/phút</span>
        </div>
        <p id="card-14-detail" class="detail">của cả hệ thống</p>
      </div>`,
    anims: [
      { t: 0.12, sel: "#card-14-kicker", kind: "maskLeft", d: 0.4 },
      { t: 0.5, sel: "#card-14-val", kind: "countUp", from: 0, to: 26.9, fmt: ".1f", d: 0.9 },
      { t: 1.1, sel: "#card-14-detail", kind: "fadeUp", d: 0.45 },
    ],
  },
  {
    id: "card-15",
    start: 92.4,
    end: 97.3,
    acc: 0,
    html: `
      <div class="wrap lower">
        <div id="card-15-kicker" class="kicker">KẾT LUẬN</div>
        <h1 id="card-15-title" class="title">${words("Đây là điểm mạnh nhất")}</h1>
        <div id="card-15-rule" class="rule"></div>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-15-kicker", kind: "maskLeft", d: 0.4 },
      { t: 1.0, sel: "#card-15-title", kind: "chars", d: 0.5, stagger: 0.07 },
      { t: 1.9, sel: "#card-15-rule", kind: "growX", w: 420, d: 0.5 },
    ],
  },
  {
    id: "card-16",
    start: 97.4,
    end: 103.0,
    acc: 3,
    html: `
      <div class="wrap lower">
        <div id="card-16-kicker" class="kicker">NÓI THẲNG</div>
        <h1 id="card-16-title" class="title small">${words("Hiệu năng thuần: không thắng GPU rời")}</h1>
        <div class="chips">
          <span id="card-16-chip1" class="chip ghost">RTX 5090</span>
          <span id="card-16-chip2" class="chip ghost">RTX 4090</span>
        </div>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-16-kicker", kind: "maskLeft", d: 0.4 },
      { t: 0.4, sel: "#card-16-title", kind: "chars", d: 0.5, stagger: 0.055 },
      { t: 3.6, sel: "#card-16-chip1", kind: "pop", d: 0.4 },
      { t: 3.85, sel: "#card-16-chip2", kind: "pop", d: 0.4 },
    ],
  },
  {
    id: "card-17",
    start: 103.1,
    end: 113.65,
    acc: 1,
    html: `
      <div class="wrap lower">
        <div class="bigmetric hero">
          <span id="card-17-val" class="bignum xl">0</span><span class="bigunit xl">GB</span>
        </div>
        <div id="card-17-rule" class="rule"></div>
        <h1 id="card-17-title" class="title">${words("MEMORY HEADROOM")}</h1>
        <p id="card-17-detail" class="detail">unified memory — thứ nó thực sự đem lại</p>
      </div>`,
    anims: [
      { t: 1.5, sel: "#card-17-val", kind: "countUp", from: 0, to: 128, fmt: ".0f", d: 1.2 },
      { t: 2.7, sel: "#card-17-rule", kind: "growX", w: 460, d: 0.5 },
      { t: 3.0, sel: "#card-17-title", kind: "chars", d: 0.55, stagger: 0.08 },
      { t: 4.0, sel: "#card-17-detail", kind: "fadeUp", d: 0.5 },
    ],
  },
  {
    id: "card-18",
    start: 113.7,
    end: 119.05,
    acc: 2,
    html: `
      <div class="wrap lower">
        <h1 id="card-18-title" class="title small">${words("Prototype hệ thống AI phức tạp")}</h1>
        <div id="card-18-rule" class="rule"></div>
        <p id="card-18-detail" class="detail">ngay trên <b>bàn làm việc</b></p>
      </div>`,
    anims: [
      { t: 0.2, sel: "#card-18-title", kind: "chars", d: 0.5, stagger: 0.06 },
      { t: 1.2, sel: "#card-18-rule", kind: "growX", w: 380, d: 0.45 },
      { t: 1.5, sel: "#card-18-detail", kind: "fadeUp", d: 0.5 },
    ],
  },
  {
    id: "card-19",
    start: 119.1,
    end: 124.1,
    acc: 3,
    html: `
      <div class="wrap lower">
        <div id="card-19-kicker" class="kicker">NẾU BẠN CHỈ</div>
        <div class="rows tight">
          <div id="card-19-i1" class="row"><span class="dot"></span><span class="rowrole big">chat với một model</span></div>
          <div id="card-19-i2" class="row"><span class="dot"></span><span class="rowrole big">chạy AI agent cá nhân</span></div>
        </div>
        <p id="card-19-detail" class="detail">raw performance sẽ không quá vượt trội</p>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-19-kicker", kind: "maskLeft", d: 0.4 },
      { t: 0.6, sel: "#card-19-i1", kind: "slideLeft", d: 0.45 },
      { t: 1.3, sel: "#card-19-i2", kind: "slideLeft", d: 0.45 },
      { t: 2.6, sel: "#card-19-detail", kind: "fadeUp", d: 0.5 },
    ],
  },
  {
    id: "card-20",
    start: 124.2,
    end: 135.25,
    acc: 1,
    html: `
      <div class="wrap lower">
        <div id="card-20-kicker" class="kicker">NHƯNG NẾU BẠN</div>
        <div class="rows tight">
          <div id="card-20-i1" class="row"><span class="dot"></span><span class="rowrole big">build AI application</span></div>
          <div id="card-20-i2" class="row"><span class="dot"></span><span class="rowrole big">fine-tuning model</span></div>
          <div id="card-20-i3" class="row"><span class="dot"></span><span class="rowrole big">chạy nhiều model / model lớn</span></div>
          <div id="card-20-i4" class="row"><span class="dot"></span><span class="rowrole big">xử lý dữ liệu, giữ hoàn toàn local</span></div>
        </div>
        <p id="card-20-detail" class="detail"><b>128GB unified memory</b> bắt đầu trở nên khá hợp lý</p>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-20-kicker", kind: "maskLeft", d: 0.4 },
      { t: 2.1, sel: "#card-20-i1", kind: "slideLeft", d: 0.45 },
      { t: 3.2, sel: "#card-20-i2", kind: "slideLeft", d: 0.45 },
      { t: 4.4, sel: "#card-20-i3", kind: "slideLeft", d: 0.45 },
      { t: 5.8, sel: "#card-20-i4", kind: "slideLeft", d: 0.45 },
      { t: 7.3, sel: "#card-20-detail", kind: "fadeUp", d: 0.5 },
    ],
  },
  {
    id: "card-21",
    start: 135.35,
    end: 140.6,
    acc: 4,
    html: `
      <div class="wrap lower">
        <div id="card-21-kicker" class="kicker">CẢM ƠN</div>
        <div class="chips big">
          <span id="card-21-chip1" class="chip">GIGABYTE</span>
          <span id="card-21-chip2" class="chip">PHONG VŨ</span>
        </div>
        <p id="card-21-detail" class="detail">đã cho mượn máy để làm video</p>
      </div>`,
    anims: [
      { t: 0.15, sel: "#card-21-kicker", kind: "maskLeft", d: 0.4 },
      { t: 0.5, sel: "#card-21-chip1", kind: "pop", d: 0.45 },
      { t: 0.75, sel: "#card-21-chip2", kind: "pop", d: 0.45 },
      { t: 1.4, sel: "#card-21-detail", kind: "fadeUp", d: 0.45 },
    ],
  },
  {
    id: "card-22",
    start: 140.7,
    end: 144.7,
    acc: 0,
    html: `
      <div class="wrap lower">
        <div class="signoff">
          <div id="card-22-name" class="signname">${graphemes("AN")}</div>
          <div id="card-22-rule" class="rule"></div>
          <div id="card-22-detail" class="signdetail">AI · công nghệ · xây dựng sản phẩm</div>
        </div>
        <div id="card-22-cta" class="cta">FOLLOW</div>
      </div>`,
    anims: [
      { t: 0.2, sel: "#card-22-name", kind: "chars", d: 0.5, stagger: 0.09 },
      { t: 0.6, sel: "#card-22-rule", kind: "growX", w: 260, d: 0.45 },
      { t: 0.85, sel: "#card-22-detail", kind: "fadeUp", d: 0.5 },
      { t: 1.5, sel: "#card-22-cta", kind: "pop", d: 0.5 },
    ],
  },
];

export { CARDS, words, graphemes };
