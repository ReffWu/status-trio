// SPDX-License-Identifier: Apache-2.0
// The macOS app's own translations (exported from its Localizable.strings),
// with Foundation-style %d / %@ / %1$d formatting.

import GLib from 'gi://GLib';

const SUPPORTED = ['ar', 'de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'zh-Hans', 'zh-Hant'];

let _strings = {};
let _fallback = {};
let _code = 'en';

function read(dir, code) {
    try {
        const [, bytes] = GLib.file_get_contents(`${dir}/${code}.json`);
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return {};
    }
}

/** Maps a POSIX locale (zh_CN.UTF-8, pt_BR, zh_TW) to one of the app's languages. */
export function resolveLanguage(names = GLib.get_language_names()) {
    for (const raw of names) {
        const name = raw.replace(/[.@].*$/, '');
        const [lang, region = ''] = name.split('_');
        if (lang === 'zh')
            return ['TW', 'HK', 'MO'].includes(region) ? 'zh-Hant' : 'zh-Hans';
        if (lang === 'pt')
            return 'pt-BR';
        if (SUPPORTED.includes(lang))
            return lang;
    }
    return 'en';
}

export function loadStrings(dir, code = resolveLanguage()) {
    _code = code;
    // linux.json holds the few strings the GNOME port adds, per language.
    const extra = read(dir, 'linux');
    _fallback = {...read(dir, 'en'), ...extra.en};
    _strings = code === 'en' ? _fallback : {...read(dir, code), ...extra[code]};
}

export function language() {
    return _code;
}

/** Looks up `key`, then formats it with `args` like String(format:). */
export function t(key, ...args) {
    const template = _strings[key] ?? _fallback[key] ?? key;
    if (!args.length)
        return template.replaceAll('%%', '%');
    let next = 0;
    return template.replace(/%(?:(\d+)\$)?([@dsf%])/g, (m, pos, kind) => {
        if (kind === '%')
            return '%';
        const value = args[pos ? Number(pos) - 1 : next++];
        return kind === 'd' ? String(Math.round(Number(value))) : String(value ?? '');
    });
}
