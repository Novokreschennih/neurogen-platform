/**
 * Сценарий для VK: тексты + VK-кнопки + метаданные
 */

import { texts } from "./common/texts.js";
import { vkTexts } from "./common/texts_vk.js";
import { stepMeta } from "./common/step_meta.js";
import { vkButtons } from "./vk/buttons.js";
import { getLinks } from "./common/get_links.js";

function buildSteps() {
  const steps = {};
  for (const key of Object.keys(texts)) {
    steps[key] = {
      // VK-specific тексты имеют приоритет над общими
      text: vkTexts[key] || texts[key],
      buttons: vkButtons[key] || null,
      image: stepMeta[key]?.image || null,
      tag: stepMeta[key]?.tag || null,
    };
  }
  return steps;
}

export default {
  getLinks,
  steps: buildSteps(),
};
