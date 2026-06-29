#!/usr/bin/env node
import { load } from "cheerio";
import crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULTS = {
  depth: 0,
  maxPages: 1,
  timeout: 15_000,
  keepScripts: true,
  includeExternalPages: false,
  clean: false,
  userAgent:
    "CopyThePage/0.1 (+https://github.com/local/copy-the-page; complete static copy)",
};

const CONTENT_TYPE_EXTENSIONS = [
  ["text/css", ".css"],
  ["text/html", ".html"],
  ["application/javascript", ".js"],
  ["text/javascript", ".js"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/avif", ".avif"],
  ["image/svg+xml", ".svg"],
  ["image/x-icon", ".ico"],
  ["font/woff2", ".woff2"],
  ["font/woff", ".woff"],
  ["font/ttf", ".ttf"],
  ["font/otf", ".otf"],
  ["application/manifest+json", ".webmanifest"],
  ["application/json", ".json"],
  ["video/mp4", ".mp4"],
  ["audio/mpeg", ".mp3"],
];

const LAZY_IMAGE_ATTRS = [
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-srcset",
  "data-original-src",
  "data-background",
  "data-bg",
  "data-bg-src",
];

function usage() {
  return `Usage:
  npm run copy -- <url> [options]

Options:
  -o, --output <dir>       Output directory. Default: copies/<host>-<timestamp>
  --depth <n>              Same-origin page crawl depth. Default: 0
  --max-pages <n>          Maximum HTML pages to copy. Default: 1
  --timeout <ms>           Request timeout in milliseconds. Default: 15000
  --user-agent <value>     Custom user agent
  --external-pages         Crawl external HTML pages too
  --no-scripts             Remove script tags instead of copying scripts
  --clean                  Delete the output directory before copying
  -h, --help               Show help`;
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { help: true, options, positional };
    }

    if (arg === "--no-scripts") {
      options.keepScripts = false;
      continue;
    }

    if (arg === "--external-pages") {
      options.includeExternalPages = true;
      continue;
    }

    if (arg === "--clean") {
      options.clean = true;
      continue;
    }

    const readValue = (name) => {
      const next = argv[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`${name} requires a value`);
      }
      index += 1;
      return next;
    };

    if (arg === "--output" || arg === "-o") {
      options.output = readValue(arg);
      continue;
    }

    if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
      continue;
    }

    if (arg === "--depth") {
      options.depth = toNonNegativeInteger(readValue(arg), "depth");
      continue;
    }

    if (arg.startsWith("--depth=")) {
      options.depth = toNonNegativeInteger(arg.slice("--depth=".length), "depth");
      continue;
    }

    if (arg === "--max-pages") {
      options.maxPages = toPositiveInteger(readValue(arg), "max-pages");
      continue;
    }

    if (arg.startsWith("--max-pages=")) {
      options.maxPages = toPositiveInteger(
        arg.slice("--max-pages=".length),
        "max-pages",
      );
      continue;
    }

    if (arg === "--timeout") {
      options.timeout = toPositiveInteger(readValue(arg), "timeout");
      continue;
    }

    if (arg.startsWith("--timeout=")) {
      options.timeout = toPositiveInteger(arg.slice("--timeout=".length), "timeout");
      continue;
    }

    if (arg === "--user-agent") {
      options.userAgent = readValue(arg);
      continue;
    }

    if (arg.startsWith("--user-agent=")) {
      options.userAgent = arg.slice("--user-agent=".length);
      continue;
    }

    positional.push(arg);
  }

  return { help: false, options, positional };
}

function toPositiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function toNonNegativeInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function normalizeStartUrl(value) {
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(value)
    ? value
    : `https://${value}`;
  const parsed = new URL(withProtocol);
  parsed.hash = "";
  return parsed.href;
}

function isSkippableUrl(value) {
  if (!value) return true;
  const trimmed = value.trim();
  return (
    !trimmed ||
    trimmed.startsWith("#") ||
    /^(data|blob|javascript|mailto|tel|sms|about):/i.test(trimmed)
  );
}

function hash(value, size = 10) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, size);
}

function sanitizeSegment(value, fallback = "asset") {
  const decoded = safeDecode(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^\.+$/g, "")
    .replace(/^-+|-+$/g, "");
  return decoded.slice(0, 120) || fallback;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function inferExtension(contentType, fallback = "") {
  const normalized = (contentType || "").split(";")[0].trim().toLowerCase();
  const found = CONTENT_TYPE_EXTENSIONS.find(([type]) => normalized === type);
  return found?.[1] || fallback;
}

function ensureExtension(filePath, extension) {
  if (!extension || path.extname(filePath)) return filePath;
  return `${filePath}${extension}`;
}

function assertSafeCleanTarget(outputDir) {
  const target = path.resolve(outputDir);
  const cwd = path.resolve(process.cwd());
  const home = path.resolve(homedir());
  const root = path.parse(target).root;
  const protectedPaths = new Set([root, home, cwd, path.dirname(cwd)]);

  if (protectedPaths.has(target) || isAncestorPath(target, cwd)) {
    throw new Error(
      `Refusing to clean unsafe output directory: ${target}. Choose a dedicated copy output directory.`,
    );
  }
}

function isAncestorPath(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function outputTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
}

function makeDefaultOutput(startUrl) {
  const url = new URL(startUrl);
  return path.join("copies", `${sanitizeSegment(url.hostname)}-${outputTimestamp()}`);
}

function normalizeFetchUrl(value) {
  const parsed = new URL(value);
  parsed.hash = "";
  return parsed.href;
}

function stripFragment(value) {
  const parsed = new URL(value);
  const fragment = parsed.hash;
  parsed.hash = "";
  return { href: parsed.href, fragment };
}

function relativePath(fromFile, toFile) {
  const rel = path.relative(path.dirname(fromFile), toFile).replaceAll(path.sep, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function parseSrcset(value) {
  const parts = [];
  let current = "";
  let quote = "";
  let parenDepth = 0;

  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);

    if (char === "," && parenDepth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

async function replaceAsync(source, regex, replacer) {
  const replacements = [];
  source.replace(regex, (...args) => {
    replacements.push({ match: args[0], index: args.at(-2), args });
    return args[0];
  });

  if (!replacements.length) return source;

  let result = "";
  let cursor = 0;
  for (const item of replacements) {
    result += source.slice(cursor, item.index);
    result += await replacer(...item.args);
    cursor = item.index + item.match.length;
  }
  result += source.slice(cursor);
  return result;
}

class SiteCopier {
  constructor(startUrl, options) {
    this.startUrl = startUrl;
    this.options = options;
    this.outputDir = path.resolve(options.output || makeDefaultOutput(startUrl));
    this.queue = [];
    this.pages = new Map();
    this.visitedPages = new Set();
    this.assetCache = new Map();
    this.localPathOwners = new Map();
    this.placeholderCache = new Map();
    this.manifest = {
      source: startUrl,
      created_at: new Date().toISOString(),
      options: {
        depth: options.depth,
        max_pages: options.maxPages,
        keep_scripts: options.keepScripts,
        include_external_pages: options.includeExternalPages,
      },
      pages: [],
      assets: [],
      missing: [],
      generated: [],
    };
  }

  async run() {
    if (this.options.clean) {
      assertSafeCleanTarget(this.outputDir);
      await rm(this.outputDir, { force: true, recursive: true });
    }
    await mkdir(this.outputDir, { recursive: true });

    this.enqueuePage(this.startUrl, 0);

    while (this.queue.length > 0 && this.visitedPages.size < this.options.maxPages) {
      const page = this.queue.shift();
      if (this.visitedPages.has(page.url)) continue;
      await this.copyPage(page.url, page.depth);
    }

    await this.writeManifest();
    await this.writeCopyReadme();
    return this.manifest;
  }

  enqueuePage(rawUrl, depth) {
    const url = normalizeFetchUrl(rawUrl);
    if (this.pages.has(url)) return this.pages.get(url);

    if (this.pages.size >= this.options.maxPages) return null;

    const localPath = this.pageOutputPath(url);
    const page = { url, depth, localPath };
    this.pages.set(url, page);
    this.queue.push(page);
    return page;
  }

  canCrawlPage(rawUrl, depth) {
    if (depth > this.options.depth) return false;
    if (this.pages.size >= this.options.maxPages) return false;
    if (this.options.includeExternalPages) return true;
    return new URL(rawUrl).origin === new URL(this.startUrl).origin;
  }

  async copyPage(pageUrl, depth) {
    const page = this.pages.get(pageUrl);
    console.log(`copy page ${pageUrl}`);

    try {
      const response = await this.fetchOk(pageUrl, {
        accept: "text/html,application/xhtml+xml",
      });
      const contentType = response.headers.get("content-type") || "";
      const html = await response.text();
      const $ = load(html, { decodeEntities: false });
      const baseHref = $("base[href]").first().attr("href");
      const documentBase = baseHref ? new URL(baseHref, pageUrl).href : pageUrl;

      await this.rewriteDocument($, documentBase, page.localPath, depth);
      $("base").remove();

      await mkdir(path.dirname(page.localPath), { recursive: true });
      await writeFile(page.localPath, $.html(), "utf8");

      this.visitedPages.add(pageUrl);
      this.manifest.pages.push({
        url: pageUrl,
        local_path: path.relative(this.outputDir, page.localPath),
        content_type: contentType,
      });
    } catch (error) {
      this.visitedPages.add(pageUrl);
      this.manifest.missing.push({
        type: "page",
        url: pageUrl,
        reason: error.message,
      });
      console.warn(`failed page ${pageUrl}: ${error.message}`);
    }
  }

  async rewriteDocument($, documentBase, ownerFile, depth) {
    $('meta[http-equiv="Content-Security-Policy" i]').remove();

    await this.rewriteAttr($, "link[href]", "href", documentBase, ownerFile, (node) => {
      const rel = ($(node).attr("rel") || "").toLowerCase();
      const as = ($(node).attr("as") || "").toLowerCase();
      if (rel.includes("canonical") || rel.includes("alternate")) return null;
      if (rel.includes("stylesheet") || as === "style") return { kind: "css" };
      return { kind: "asset" };
    });

    if (this.options.keepScripts) {
      await this.rewriteAttr($, "script[src]", "src", documentBase, ownerFile, () => ({
        kind: "script",
      }));
    } else {
      $("script").remove();
    }

    await this.rewriteAttr($, "img[src]", "src", documentBase, ownerFile, () => ({
      kind: "image",
    }));
    await this.rewriteAttr($, "source[src]", "src", documentBase, ownerFile, () => ({
      kind: "asset",
    }));
    await this.rewriteAttr($, "video[src], audio[src], embed[src], iframe[src]", "src", documentBase, ownerFile, () => ({
      kind: "asset",
    }));
    await this.rewriteAttr($, "video[poster]", "poster", documentBase, ownerFile, () => ({
      kind: "image",
    }));
    await this.rewriteAttr($, "object[data]", "data", documentBase, ownerFile, () => ({
      kind: "asset",
    }));
    await this.rewriteAttr($, "track[src]", "src", documentBase, ownerFile, () => ({
      kind: "asset",
    }));
    await this.rewriteAttr($, "image[href]", "href", documentBase, ownerFile, () => ({
      kind: "image",
    }));
    await this.rewriteAttr($, "image[xlink\\:href]", "xlink:href", documentBase, ownerFile, () => ({
      kind: "image",
    }));
    await this.rewriteAttr(
      $,
      'meta[property="og:image"][content], meta[name="twitter:image"][content]',
      "content",
      documentBase,
      ownerFile,
      () => ({ kind: "image" }),
    );

    await this.rewriteSrcsetAttrs($, "img[srcset], source[srcset]", "srcset", documentBase, ownerFile);

    for (const attr of LAZY_IMAGE_ATTRS) {
      await this.rewriteLazyAttr($, `[${attr}]`, attr, documentBase, ownerFile);
    }

    await this.rewriteInlineStyles($, documentBase, ownerFile);
    await this.rewriteAnchors($, documentBase, ownerFile, depth);
  }

  async rewriteAttr($, selector, attr, baseUrl, ownerFile, hintsForNode) {
    const nodes = $(selector).toArray();
    for (const node of nodes) {
      const $node = $(node);
      const value = $node.attr(attr);
      if (isSkippableUrl(value)) continue;

      const hints = hintsForNode(node);
      if (!hints) continue;

      const rewritten = await this.copyAsset(value, baseUrl, ownerFile, hints);
      if (rewritten) $node.attr(attr, rewritten);
    }
  }

  async rewriteLazyAttr($, selector, attr, baseUrl, ownerFile) {
    const nodes = $(selector).toArray();
    for (const node of nodes) {
      const $node = $(node);
      const value = $node.attr(attr);
      if (isSkippableUrl(value)) continue;

      if (attr.endsWith("srcset")) {
        const rewritten = await this.rewriteSrcset(value, baseUrl, ownerFile);
        if (rewritten) {
          $node.attr(attr, rewritten);
          if (!$node.attr("srcset")) $node.attr("srcset", rewritten);
        }
        continue;
      }

      const rewritten = await this.copyAsset(value, baseUrl, ownerFile, {
        kind: "image",
        fallbackLabel: $node.attr("alt") || "missing image",
      });
      if (!rewritten) continue;

      $node.attr(attr, rewritten);
      const currentSrc = $node.attr("src");
      if (!currentSrc || isPlaceholderSrc(currentSrc)) {
        $node.attr("src", rewritten);
      }
    }
  }

  async rewriteSrcsetAttrs($, selector, attr, baseUrl, ownerFile) {
    const nodes = $(selector).toArray();
    for (const node of nodes) {
      const $node = $(node);
      const value = $node.attr(attr);
      if (!value) continue;
      const rewritten = await this.rewriteSrcset(value, baseUrl, ownerFile);
      if (rewritten) $node.attr(attr, rewritten);
    }
  }

  async rewriteSrcset(value, baseUrl, ownerFile) {
    const parts = parseSrcset(value);
    const rewritten = [];

    for (const part of parts) {
      const [rawUrl, ...descriptor] = part.split(/\s+/);
      if (isSkippableUrl(rawUrl)) {
        rewritten.push(part);
        continue;
      }

      const local = await this.copyAsset(rawUrl, baseUrl, ownerFile, {
        kind: "image",
      });
      rewritten.push([local || rawUrl, ...descriptor].join(" "));
    }

    return rewritten.join(", ");
  }

  async rewriteInlineStyles($, baseUrl, ownerFile) {
    const styleNodes = $("style").toArray();
    for (const node of styleNodes) {
      const current = $(node).html();
      if (!current) continue;
      $(node).html(await this.rewriteCss(current, baseUrl, ownerFile));
    }

    const styledNodes = $("[style]").toArray();
    for (const node of styledNodes) {
      const current = $(node).attr("style");
      if (!current) continue;
      $(node).attr("style", await this.rewriteCss(current, baseUrl, ownerFile));
    }
  }

  async rewriteAnchors($, documentBase, ownerFile, depth) {
    const nodes = $("a[href]").toArray();
    for (const node of nodes) {
      const $node = $(node);
      const value = $node.attr("href");
      if (isSkippableUrl(value)) continue;

      let resolved;
      try {
        resolved = new URL(value, documentBase);
      } catch {
        continue;
      }

      const fragment = resolved.hash;
      resolved.hash = "";

      const normalized = resolved.href;
      if (!/^https?:$/i.test(resolved.protocol)) continue;

      let page = this.pages.get(normalized);
      if (!page && this.canCrawlPage(normalized, depth + 1)) {
        page = this.enqueuePage(normalized, depth + 1);
      }

      if (page) {
        $node.attr("href", `${relativePath(ownerFile, page.localPath)}${fragment}`);
      }
    }
  }

  async rewriteCss(css, cssBaseUrl, ownerFile) {
    let rewritten = await replaceAsync(
      css,
      /@import\s+(["'])([^"']+)\1/gi,
      async (match, quote, rawUrl) => {
        if (isSkippableUrl(rawUrl)) return match;
        const local = await this.copyAsset(rawUrl, cssBaseUrl, ownerFile, {
          kind: "css",
        });
        return local ? `@import ${quote}${local}${quote}` : match;
      },
    );

    rewritten = await replaceAsync(
      rewritten,
      /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
      async (match, quote, rawUrl) => {
        const trimmed = rawUrl.trim();
        if (
          isSkippableUrl(trimmed) ||
          trimmed.startsWith("var(") ||
          trimmed.startsWith("env(")
        ) {
          return match;
        }

        const local = await this.copyAsset(trimmed, cssBaseUrl, ownerFile, {
          kind: "asset",
        });
        if (!local) return match;
        const q = quote || "";
        return `url(${q}${local}${q})`;
      },
    );

    return rewritten;
  }

  async copyAsset(rawValue, baseUrl, ownerFile, hints = {}) {
    let resolved;
    try {
      resolved = new URL(rawValue.trim(), baseUrl);
    } catch {
      return rawValue;
    }

    if (!/^https?:$/i.test(resolved.protocol)) return rawValue;

    const { href: assetUrl, fragment } = stripFragment(resolved.href);
    const cacheKey = `${assetUrl}|${hints.kind || "asset"}`;
    const cached = this.assetCache.get(cacheKey);
    if (cached) return `${relativePath(ownerFile, cached)}${fragment}`;

    try {
      const { response, finalUrl, strategy } = await this.fetchAssetWithFallback(
        assetUrl,
        hints,
      );
      const contentType = response.headers.get("content-type") || "";
      const isCss =
        hints.kind === "css" ||
        contentType.toLowerCase().includes("text/css") ||
        new URL(finalUrl).pathname.toLowerCase().endsWith(".css");
      const localPath = this.assetOutputPath(finalUrl, contentType, hints.kind);

      this.assetCache.set(cacheKey, localPath);
      await mkdir(path.dirname(localPath), { recursive: true });

      if (isCss) {
        const text = await response.text();
        const rewritten = await this.rewriteCss(text, finalUrl, localPath);
        await writeFile(localPath, rewritten, "utf8");
        this.recordAsset(finalUrl, localPath, contentType, Buffer.byteLength(rewritten), strategy);
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(localPath, buffer);
        this.recordAsset(finalUrl, localPath, contentType, buffer.byteLength, strategy);
      }

      return `${relativePath(ownerFile, localPath)}${fragment}`;
    } catch (error) {
      this.manifest.missing.push({
        type: hints.kind || "asset",
        url: assetUrl,
        reason: error.message,
      });

      if (hints.kind === "image" || isLikelyImage(assetUrl)) {
        const placeholder = await this.createImagePlaceholder(
          assetUrl,
          hints.fallbackLabel || "missing image",
        );
        return relativePath(ownerFile, placeholder);
      }

      return rawValue;
    }
  }

  async fetchAssetWithFallback(assetUrl, hints) {
    const candidates = this.buildFallbackCandidates(assetUrl);
    let lastError = new Error("asset request failed");

    for (const [index, candidate] of candidates.entries()) {
      try {
        const response = await this.fetchOk(candidate, {
          accept: acceptHeaderForKind(hints.kind),
        });
        return {
          response,
          finalUrl: response.url || candidate,
          strategy: index === 0 ? "direct" : "fallback",
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  buildFallbackCandidates(assetUrl) {
    const candidates = [];
    const push = (value) => {
      if (!candidates.includes(value)) candidates.push(value);
    };

    const url = new URL(assetUrl);
    push(url.href);

    const noHash = new URL(url.href);
    noHash.hash = "";
    push(noHash.href);

    if (url.search) {
      const noQuery = new URL(url.href);
      noQuery.search = "";
      noQuery.hash = "";
      push(noQuery.href);
    }

    if (url.pathname.includes("%")) {
      try {
        const decoded = new URL(url.href);
        decoded.pathname = decodeURI(decoded.pathname);
        push(decoded.href);
      } catch {
        // Keep the original candidates.
      }
    }

    const alternateProtocol = new URL(url.href);
    alternateProtocol.protocol = url.protocol === "https:" ? "http:" : "https:";
    push(alternateProtocol.href);

    return candidates;
  }

  async fetchOk(url, { accept }) {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(this.options.timeout),
      headers: {
        accept,
        "accept-language": "ja,en-US;q=0.9,en;q=0.8",
        "user-agent": this.options.userAgent,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response;
  }

  pageOutputPath(rawUrl) {
    const url = new URL(rawUrl);
    const segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => sanitizeSegment(part, "page"));
    let fileName = "index.html";

    if (segments.length > 0 && !url.pathname.endsWith("/")) {
      fileName = segments.pop();
      if (!path.extname(fileName)) {
        segments.push(fileName);
        fileName = "index.html";
      } else if (path.extname(fileName).toLowerCase() !== ".html") {
        fileName = `${fileName}.html`;
      }
    }

    if (url.search) {
      fileName = appendHashBeforeExtension(fileName, url.search);
    }

    return path.join(this.outputDir, ...segments, fileName);
  }

  assetOutputPath(rawUrl, contentType, kind = "asset") {
    const url = new URL(rawUrl);
    const host = sanitizeSegment(url.hostname, "external");
    const segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => sanitizeSegment(part));

    let fileName = segments.pop() || "index";
    const fallbackExtension = inferExtension(contentType, extensionForKind(kind));
    fileName = ensureExtension(fileName, fallbackExtension);

    if (url.search) {
      fileName = appendHashBeforeExtension(fileName, url.search);
    }

    let localPath = path.join(this.outputDir, "assets", host, ...segments, fileName);
    const owner = this.localPathOwners.get(localPath);
    if (owner && owner !== rawUrl) {
      localPath = appendHashBeforeExtension(localPath, rawUrl);
    }
    this.localPathOwners.set(localPath, rawUrl);
    return localPath;
  }

  async createImagePlaceholder(assetUrl, label) {
    const cacheKey = assetUrl;
    const cached = this.placeholderCache.get(cacheKey);
    if (cached) return cached;

    const localPath = path.join(
      this.outputDir,
      "assets",
      "_generated",
      `missing-${hash(assetUrl)}.svg`,
    );
    const escapedLabel = escapeXml(String(label).slice(0, 80));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-label="${escapedLabel}">
  <rect width="1200" height="675" fill="#f3f4f6"/>
  <rect x="24" y="24" width="1152" height="627" fill="none" stroke="#cbd5e1" stroke-width="3" stroke-dasharray="16 14"/>
  <text x="600" y="320" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" fill="#475569">missing image</text>
  <text x="600" y="372" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="#64748b">${escapedLabel}</text>
</svg>
`;
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, svg, "utf8");
    this.placeholderCache.set(cacheKey, localPath);
    this.manifest.generated.push({
      type: "image-placeholder",
      source_url: assetUrl,
      local_path: path.relative(this.outputDir, localPath),
    });
    return localPath;
  }

  recordAsset(url, localPath, contentType, bytes, strategy) {
    this.manifest.assets.push({
      url,
      local_path: path.relative(this.outputDir, localPath),
      content_type: contentType,
      bytes,
      strategy,
    });
  }

  async writeManifest() {
    const manifestPath = path.join(this.outputDir, "copy-the-page-manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(this.manifest, null, 2)}\n`, "utf8");
  }

  async writeCopyReadme() {
    const readmePath = path.join(this.outputDir, "README.md");
    const page = this.pages.get(normalizeFetchUrl(this.startUrl));
    const entry = page ? path.relative(this.outputDir, page.localPath) : "index.html";
    const body = `# Copy the Page site copy

Source: ${this.startUrl}
Entry: ${entry}
Manifest: copy-the-page-manifest.json

Open the entry file in a browser, or serve this directory with a static server.
`;
    await writeFile(readmePath, body, "utf8");
  }
}

function isPlaceholderSrc(value) {
  return (
    value.startsWith("data:") ||
    value.includes("placeholder") ||
    value.includes("spacer") ||
    value.includes("blank")
  );
}

function isLikelyImage(value) {
  return /\.(avif|gif|jpe?g|png|svg|webp|ico)(?:$|[?#])/i.test(value);
}

function acceptHeaderForKind(kind) {
  if (kind === "css") return "text/css,*/*;q=0.8";
  if (kind === "image") return "image/avif,image/webp,image/*,*/*;q=0.8";
  if (kind === "script") return "application/javascript,text/javascript,*/*;q=0.8";
  return "*/*";
}

function extensionForKind(kind) {
  if (kind === "css") return ".css";
  if (kind === "script") return ".js";
  return "";
}

function appendHashBeforeExtension(filePath, value) {
  const extension = path.extname(filePath);
  const stem = extension ? filePath.slice(0, -extension.length) : filePath;
  return `${stem}.${hash(value, 8)}${extension}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function main() {
  const { help, options, positional } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(usage());
    return;
  }

  if (positional.length !== 1) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const startUrl = normalizeStartUrl(positional[0]);
  const copier = new SiteCopier(startUrl, options);
  const manifest = await copier.run();
  const output = path.relative(process.cwd(), copier.outputDir) || ".";
  console.log(
    `done: ${output} (${manifest.pages.length} pages, ${manifest.assets.length} assets, ${manifest.missing.length} missing)`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
