// eleventy.config.js (ВЕРСИЯ PRO: ПОЛНАЯ ЗАЩИТА ЧЕРНОВИКОВ)

import { EleventyHtmlBasePlugin } from "@11ty/eleventy";
import { feedPlugin } from "@11ty/eleventy-plugin-rss";
import pluginSyntaxHighlight from "@11ty/eleventy-plugin-syntaxhighlight";
import pluginNavigation from "@11ty/eleventy-navigation";
import Image from "@11ty/eleventy-img";
import pluginFilters from "./src/_config/filters.js";
import { minify } from "html-minifier-terser";

/** @param {import("@11ty/eleventy").UserConfig} eleventyConfig */
export default async function (eleventyConfig) {
	// 1. ОПРЕДЕЛЯЕМ ОКРУЖЕНИЕ
	// Если мы запускаем сборку на сервере (Netlify/Vercel/GitHub), считаем это 'production'
	const isProduction = process.env.ELEVENTY_ENV === "production" || process.env.NODE_ENV === "production";

	// 2. ФИЛЬТРАЦИЯ КОЛЛЕКЦИЙ
	// В продакшене убираем черновики. Локально — показываем всё.
	eleventyConfig.addCollection("posts", (collectionApi) => {
		return collectionApi
			.getFilteredByGlob("./src/content/blog/**/*.md")
			.filter((item) => {
				return isProduction ? !item.data.draft : true;
			});
	});

	eleventyConfig.addCollection("news", (collectionApi) => {
		return collectionApi
			.getFilteredByGlob("./src/content/news/**/*.md")
			.filter((item) => {
				return isProduction ? !item.data.draft : true;
			});
	});

	// 3. ГЛОБАЛЬНАЯ ЗАЩИТА (ЧТОБЫ ФАЙЛЫ НЕ СОЗДАВАЛИСЬ)
	// Если это продакшен и стоит draft: true, мы отключаем генерацию ссылки (permalink: false)
	eleventyConfig.addGlobalData("eleventyComputed", {
		permalink: (data) => {
			if (isProduction && data.draft) {
				return false;
			}
			return data.permalink;
		},
		eleventyExcludeFromCollections: (data) => {
			if (isProduction && data.draft) {
				return true;
			}
			return data.eleventyExcludeFromCollections;
		}
	});

	// --- КОПИРОВАНИЕ ФАЙЛОВ ---
	eleventyConfig.addPassthroughCopy("src/css");
	eleventyConfig.addPassthroughCopy("src/js");
	eleventyConfig.addPassthroughCopy("src/fonts");
	eleventyConfig.addPassthroughCopy({ "src/public/": "/" });
	eleventyConfig.addPassthroughCopy("src/**/*.{jpg,jpeg,png,gif,svg,webp}");
	eleventyConfig.addPassthroughCopy("src/_redirects");
	eleventyConfig.addPassthroughCopy("src/js/sw.js"); // Service Worker в корень

	// --- ШОРТКОД ДЛЯ ИЗОБРАЖЕНИЙ ---
	eleventyConfig.addNunjucksAsyncShortcode(
		"image",
		async function (src, alt, sizes = "100vw") {
			if (!src) return;

			// Исправление путей
			let filepath = `./src${this.page.filePathStem.substring(
				0,
				this.page.filePathStem.lastIndexOf("/")
			)}/${src}`;

			if (src.startsWith("/")) {
				filepath = `./src${src}`;
			}

			try {
				let metadata = await Image(filepath, {
					widths: [400, 800, 1200, "auto"],
					formats: ["webp", "jpeg"],
					outputDir: "./_site/img/",
					urlPath: "/img/",
				});

				let imageAttributes = {
					alt,
					sizes,
					loading: "lazy",
					decoding: "async",
				};

				const pictureHTML = Image.generateHTML(metadata, imageAttributes);
				const largestImage = metadata.jpeg[metadata.jpeg.length - 1];

				return `<a href="${largestImage.url}" class="lightbox-trigger">${pictureHTML}</a>`;
			} catch (e) {
				console.error(`[Image Error] ${filepath}: ${e.message}`);
				return `<p style="color: var(--accent);">⚠️ Изображение не найдено: ${alt || src}</p>`;
			}
		}
	);

	// --- ПЛАГИНЫ ---
	eleventyConfig.addWatchTarget("src/css/**/*.css");

	eleventyConfig.addPlugin(pluginSyntaxHighlight, {
		preAttributes: { tabindex: 0 },
	});
	eleventyConfig.addPlugin(pluginNavigation);
	eleventyConfig.addPlugin(EleventyHtmlBasePlugin);

	eleventyConfig.addPlugin(feedPlugin, {
		type: "atom",
		outputPath: "/feed/feed.xml",
		collection: {
			name: "posts",
			limit: 10,
		},
		metadata: {
			language: "ru",
			title: "Блог SetHubble",
			subtitle: "Новости, обновления и инсайты.",
			base: "https://sethubble.ru/",
			author: { name: "SetHubble" },
		},
	});

	// RSS для новостей
	eleventyConfig.addPlugin(feedPlugin, {
		type: "atom",
		outputPath: "/feed/news.xml",
		collection: {
			name: "news",
			limit: 10,
		},
		metadata: {
			language: "ru",
			title: "Новости SetHubble",
			subtitle: "Последние новости и обновления платформы.",
			base: "https://sethubble.ru/",
			author: { name: "SetHubble" },
		},
	});

	eleventyConfig.addPlugin(pluginFilters);

	eleventyConfig.addShortcode("currentBuildDate", () =>
		new Date().toISOString()
	);

	// --- МИНИФИКАЦИЯ HTML (только в production) ---
	if (isProduction) {
		eleventyConfig.addTransform("html-minify", async (content, outputPath) => {
			if (outputPath && outputPath.endsWith(".html")) {
				try {
					return await minify(content, {
						useShortDoctype: true,
						removeComments: true,
						collapseWhitespace: true,
						minifyCSS: true,
						minifyJS: true,
					});
				} catch (e) {
					console.error("HTML minification error:", e);
					return content;
				}
			}
			return content;
		});
	}

	return {
		templateFormats: ["md", "njk", "html"],
		markdownTemplateEngine: "njk",
		htmlTemplateEngine: "njk",
		dir: {
			input: "src",
			includes: "_includes",
			data: "_data",
			output: "_site",
		},
	};
}
