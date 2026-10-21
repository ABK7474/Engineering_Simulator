// İçerik bağlantısı: elle yazılmış şablonlar ve derleyicinin kayıtlı çıktıları (npm run gen:cs).

import generated from '../../../content/generated/cs-output.json';
import templatesJson from '../../../content/cs-output/templates.json';
import type { CsGenerated, CsTemplate } from './cs-output';

export const CS_TEMPLATES = templatesJson.templates as unknown as CsTemplate[];
export const CS_GENERATED = generated as unknown as CsGenerated;
