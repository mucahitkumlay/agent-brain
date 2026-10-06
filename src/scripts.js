import hook from '../scripts/brain-hook.sh';
import flush from '../scripts/brain-flush.sh';
import link from '../scripts/brain-link.sh';
import tmpl from '../scripts/install.tmpl.sh';
// function replacements: the scripts contain "$" sequences that String.replace would otherwise interpret
export const INSTALL_SH = tmpl.replace('@@HOOK@@', () => hook.trimEnd()).replace('@@FLUSH@@', () => flush.trimEnd()).replace('@@LINK@@', () => link.trimEnd());
