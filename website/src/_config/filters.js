import { DateTime } from "luxon";

export default function (eleventyConfig) {
	eleventyConfig.addFilter("readableDate", (dateObj, format, zone) => {
		const dt = DateTime.fromJSDate(dateObj, { zone: zone || "utc" });
		if (!dt.isValid) {
			return "Invalid Date";
		}
		return dt.setLocale("ru").toLocaleString(DateTime.DATE_FULL);
	});

	eleventyConfig.addFilter("htmlDateString", (dateObj) => {
		return DateTime.fromJSDate(dateObj, { zone: "utc" }).toFormat("yyyy-LL-dd");
	});

	// Удаление HTML тегов
	eleventyConfig.addFilter("strip_html", (content) => {
		if (!content) return "";
		return content.replace(/<[^>]*>/g, "");
	});

	eleventyConfig.addFilter("striptags", (content) => {
		if (!content) return "";
		return content.replace(/<[^>]*>/g, "");
	});

	// Get the first `n` elements of a collection.
	eleventyConfig.addFilter("head", (array, n) => {
		if (!Array.isArray(array) || array.length === 0) {
			return [];
		}
		if (n < 0) {
			return array.slice(n);
		}
		return array.slice(0, n);
	});

	// Return the smallest number argument
	eleventyConfig.addFilter("min", (...numbers) => {
		return Math.min.apply(null, numbers);
	});

	// Return the keys used in an object
	eleventyConfig.addFilter("getKeys", (target) => {
		return Object.keys(target);
	});

	eleventyConfig.addFilter("filterTagList", function filterTagList(tags) {
		return (tags || []).filter(
			(tag) => ["all", "nav", "post", "posts"].indexOf(tag) === -1
		);
	});

	// Сортировка по алфавиту
	eleventyConfig.addFilter("sortAlphabetically", (strings) =>
		(strings || []).sort((b, a) => b.localeCompare(a))
	);

	// Время чтения статьи (слов в минуту)
	eleventyConfig.addFilter("readingTime", (content) => {
		const wpm = 200;
		const words = content.replace(/<[^>]*>/g, '').split(/\s+/).length;
		const minutes = Math.ceil(words / wpm);
		return `${minutes} мин`;
	});

	// Связанные посты (по тегам)
	eleventyConfig.addFilter("getRelatedPosts", (posts, tags, currentSlug, limit = 3) => {
		if (!tags || tags.length === 0) return [];

		const related = posts.filter((post) => {
			if (post.data.pageSlug === currentSlug) return false;

			const postTags = post.data.tags || [];
			const commonTags = tags.filter((tag) => postTags.includes(tag));
			return commonTags.length > 0;
		});

		related.sort((a, b) => {
			const tagsA = a.data.tags || [];
			const tagsB = b.data.tags || [];
			const commonA = tags.filter((tag) => tagsA.includes(tag)).length;
			const commonB = tags.filter((tag) => tagsB.includes(tag)).length;
			return commonB - commonA;
		});

		return related.slice(0, limit);
	});

	// Извлечение заголовков для оглавления
	eleventyConfig.addFilter("getHeadings", (content) => {
		if (!content) return [];
		
		const headingRegex = /<h([2-4])(?:[^>]+)?\s+id=["']([^"']+)["'][^>]*>([^<]+)<\/h\1>/gi;
		const headings = [];
		let match;
		
		while ((match = headingRegex.exec(content)) !== null) {
			headings.push({
				level: match[1],
				id: match[2],
				text: match[3].replace(/<[^>]*>/g, "").trim()
			});
		}
		
		return headings;
	});
}
