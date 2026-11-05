import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = ['../CrewBoard_CYD/sd-card/crewboard/www/', '../crewboard/www/'];
const themeDirectory = fileURLToPath(new URL('../crewboard/css/', import.meta.url));
const bundledThemes = [
  'brite.min.css', 'cosmo.min.css', 'cyborg.min.css', 'darkly.min.css',
  'flatly.min.css', 'journal.min.css', 'lux.min.css', 'materia.min.css',
  'morph.min.css', 'quartz.min.css', 'sandstone.min.css', 'sketchy.min.css',
  'slate.min.css', 'superhero.min.css', 'vapor.min.css', 'yeti.min.css'
];

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `Missing CSS rule: ${selector}`);
  return match[1];
}

function declaration(cssRule, property, important = false) {
  const match = cssRule.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  assert.ok(match, `Missing CSS declaration: ${property}`);
  if (important) assert.match(match[1], /!important\s*$/);
  return match[1].replace(/\s*!important\s*$/, '').trim();
}

function resolveColor(value, theme) {
  const variable = /^var\((--[\w-]+),\s*(#[\da-f]+)\)$/i.exec(value);
  if (!variable) return value;
  const match = theme.match(new RegExp(`${variable[1]}\\s*:\\s*([^;}]+)`));
  return match ? match[1].trim() : variable[2];
}

function parseColor(value) {
  const named = { white: '#ffffff', whitesmoke: '#f5f5f5' };
  let color = named[value.toLowerCase()] || value;
  if (/^#[\da-f]{3}$/i.test(color)) color = '#' + [...color.slice(1)].map((digit) => digit + digit).join('');
  if (/^#[\da-f]{6}$/i.test(color)) {
    return [...color.slice(1).matchAll(/[\da-f]{2}/gi)].map((part) => parseInt(part[0], 16)).concat(1);
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color);
  assert.ok(rgb, `Unsupported test color: ${value}`);
  const channels = rgb[1].split(',').map((part) => Number(part.trim()));
  assert.ok(channels.length === 3 || channels.length === 4, `Invalid test color: ${value}`);
  return channels.length === 3 ? channels.concat(1) : channels;
}

function composite(color, background) {
  return color.slice(0, 3).map((channel, index) => channel * color[3] + background[index] * (1 - color[3]));
}

function contrast(foreground, background, underlay) {
  const bg = composite(parseColor(background), underlay);
  const fg = composite(parseColor(foreground), bg);
  const luminance = (channels) => channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const first = luminance(fg);
  const second = luminance(bg);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

for (const asset of assets) {
  test(`${asset} supplies a meaningful page description`, () => {
    const html = fs.readFileSync(new URL('index.html', new URL(asset, import.meta.url)), 'utf8');
    const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    assert.ok(description);
    assert.ok(description[1].length >= 40);
    assert.match(description[1], /CrewBoard/i);
  });

  test(`${asset} keeps status badges above 4.5:1 across bundled themes`, () => {
    const css = fs.readFileSync(new URL('app.css', new URL(asset, import.meta.url)), 'utf8');
    const flatBadges = css.match(/([^{}]+)\{\s*background-image:\s*none;\s*\}/);
    assert.ok(flatBadges);
    const flatSelectors = flatBadges[1].split(',').map((selector) => selector.trim());
    const themes = [
      ['fallback colors', ''],
      ['classic', fs.readFileSync(new URL('vendor/bootstrap.min.css', new URL(asset, import.meta.url)), 'utf8')],
      ...bundledThemes.map((name) => [name, fs.readFileSync(path.join(themeDirectory, name), 'utf8')])
    ];
    for (const kind of ['success', 'info', 'warning', 'danger', 'secondary', 'light']) {
      assert.ok(flatSelectors.includes(`.badge.text-bg-${kind}`), `${kind} badge must not have a gradient`);
      const badge = rule(css, `.badge.text-bg-${kind}`);
      const foreground = declaration(badge, 'color', true);
      const background = declaration(badge, 'background-color', true);
      for (const [name, theme] of themes) {
        for (const underlay of [[255, 255, 255], [0, 0, 0]]) {
          const ratio = contrast(resolveColor(foreground, theme), resolveColor(background, theme), underlay);
          assert.ok(ratio >= 4.5, `${name} ${kind} badge contrast is ${ratio.toFixed(2)}:1`);
        }
      }
    }
  });

  test(`${asset} keeps classic secondary text and controls legible`, () => {
    const css = fs.readFileSync(new URL('app.css', new URL(asset, import.meta.url)), 'utf8');
    const palette = 'html[data-crew-palette="classic"]';
    const background = declaration(rule(css, `${palette} body`), 'background');
    const text = declaration(rule(css, `${palette} .text-secondary`), 'color', true);
    const button = declaration(rule(css, `${palette} .btn-outline-secondary`), '--bs-btn-color');
    for (const color of [text, button]) {
      assert.ok(contrast(color, background, [255, 255, 255]) >= 4.5);
      assert.ok(contrast(color, '#ffffff', [255, 255, 255]) >= 4.5);
    }
  });
}
