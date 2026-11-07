// SPDX-License-Identifier: Apache-2.0
// GType names are process-global. Suffixing them with a hash of this module's
// URI keeps a copy of the extension loaded from another directory (dev reloads)
// from clashing with the classes an earlier copy registered.

import GLib from 'gi://GLib';

const SUFFIX = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, import.meta.url, -1).slice(0, 8);

export function typeName(name) {
    return `StatusTrio${name}_${SUFFIX}`;
}
