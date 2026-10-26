import { describe, expect, it } from 'vitest';
import { mdToHtml } from './md-view';

describe('md görüntüleyici', () => {
  it('başlık, liste, kalın, formül', () => {
    expect(mdToHtml('## Ohm\n- **V** = $I \\cdot R$\n- `R` direnç\n\nSon.')).toBe(
      '<h4>Ohm</h4><ul><li><b>V</b> = <code class="tex">I \\cdot R</code></li><li><code>R</code> direnç</li></ul><p>Son.</p>',
    );
  });
  it('HTML yorumlanmaz', () => {
    const html = mdToHtml('<img src=x onerror=alert(1)>\n- <script>alert(1)</script>\n## <b onclick=x>');
    expect(html).not.toMatch(/<img|<script|<b onclick/);
    expect(html).toContain('&#60;img src=x onerror=alert(1)&#62;');
  });
});
