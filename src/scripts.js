import hook from '../scripts/brain-hook.sh' with { type: 'text' };
import flush from '../scripts/brain-flush.sh' with { type: 'text' };
import link from '../scripts/brain-link.sh' with { type: 'text' };
import tmpl from '../scripts/install.tmpl.sh' with { type: 'text' };
// function replacements: the scripts contain "$" sequences that String.replace would otherwise interpret
export const INSTALL_SH = tmpl.replace('@@HOOK@@', () => hook.trimEnd()).replace('@@FLUSH@@', () => flush.trimEnd()).replace('@@LINK@@', () => link.trimEnd());
