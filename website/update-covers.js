#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

// Маппинг тегов к SVG обложкам
const tagToImage = {
  'sethubble-guide': '/img/sethubble-guide.svg',
  'sethubble-strategy': '/img/sethubble-strategy.svg',
  'case-study': '/img/case-study.svg',
  'cryptocurrencies': '/img/cryptocurrencies.svg',
  'automation': '/img/automation.svg',
  'referral-system': '/img/referral-system.svg',
  'crypto-payments': '/img/crypto-payments.svg',
  'for-bloggers': '/img/for-bloggers.svg',
  'monetization': '/img/monetization.svg',
  'comparison': '/img/comparison.svg',
  'growth-strategies': '/img/growth-strategies.svg',
  'traffic': '/img/traffic.svg',
  'for-beginners': '/img/for-beginners.svg',
  'affiliate-marketing': '/img/affiliate-marketing.svg',
  'digital-trap': '/img/digital-trap.svg',
  'binary-system': '/img/binary-system.svg',
  'linear-system': '/img/linear-system.svg',
};

const blogDir = './src/content/blog';

// Получаем все MD файлы
const files = fs.readdirSync(blogDir).filter(f => f.endsWith('.md'));

files.forEach(file => {
  const filePath = path.join(blogDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Находим front matter
  const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontMatterMatch) return;
  
  const frontMatter = frontMatterMatch[1];
  
  // Находим теги
  const tagsMatch = frontMatter.match(/tags:\s*\n([\s\S]*?)(?=\n\w|---|$)/);
  if (!tagsMatch) return;
  
  const tagsBlock = tagsMatch[1];
  const tags = tagsBlock.match(/-\s*['"]?([\w-]+)['"]?/g);
  
  if (!tags) return;
  
  // Находим первый подходящий тег
  let image = null;
  for (const tagLine of tags) {
    const tag = tagLine.replace(/-\s*['"]?/g, '').trim();
    if (tagToImage[tag]) {
      image = tagToImage[tag];
      break;
    }
  }
  
  // Если нашли обложку и её ещё нет в статье
  if (image && !frontMatter.includes('image:')) {
    // Вставляем image после date
    const newFrontMatter = frontMatter.replace(
      /(date:\s*[\d-]+)/,
      `$1\nimage: "${image}"`
    );
    
    content = content.replace(frontMatterMatch[0], `---\n${newFrontMatter}\n---`);
    fs.writeFileSync(filePath, content);
    console.log(`✓ ${file} → ${image}`);
  }
});

console.log('Готово!');
