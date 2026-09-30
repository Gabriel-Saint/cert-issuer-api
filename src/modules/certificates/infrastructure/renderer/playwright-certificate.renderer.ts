import { Injectable } from '@nestjs/common';
import { chromium } from 'playwright';
import QRCode from 'qrcode';
import {
  CertificateRendererPort,
  CertificateRenderInput,
} from '../../application/ports/certificate-renderer.port';

@Injectable()
export class PlaywrightCertificateRenderer implements CertificateRendererPort {
  async render(input: CertificateRenderInput): Promise<Buffer> {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ locale: 'pt-BR' });
      const qrCode = await QRCode.toDataURL(input.verificationUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 200,
      });
      const html = this.createHtml(input, qrCode);

      await page.setContent(html, { waitUntil: 'load' });
      await page.waitForSelector('[data-ready="1"]', { timeout: 15000 });
      return await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
    } finally {
      await browser.close();
    }
  }

  private createHtml(input: CertificateRenderInput, qrCode: string): string {
    const { snapshot } = input;

    const responsibleName  = snapshot.responsibleName ?? 'Responsável pelo curso';
    const responsibleRole  = snapshot.responsibleRole ?? '';
    // Remove títulos acadêmicos do nome para exibição caligráfica
    const sigScript = responsibleName.replace(/^(Prof\.?a?|Dr\.?a?|Me\.?|Esp\.?|Msc\.?)\s+/i, '');

    const modeLabel = snapshot.deliveryMode === 'in_person' ? 'Presencial' : 'Online';

    // Iniciais da instituição (ignora conectivos)
    const initials = snapshot.institutionName
      .split(/\s+/)
      .filter(w => !['de','da','do','das','dos','e','a','o'].includes(w.toLowerCase()))
      .slice(0, 3)
      .map(w => w[0].toUpperCase())
      .join('');

    // Data por extenso em pt-BR
    const fmtDate = (iso: string) => {
      try {
        const [y, m, d] = iso.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('pt-BR', {
          day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
        });
      } catch { return this.escape(iso); }
    };
    const completionFormatted = fmtDate(snapshot.completionDate);

    // Guilloché: ondas senoidais percorrendo o perímetro — gera path SVG
    const W = 297, H = 210;
    function guillochePath(phase: number, amp: number, freq: number): string {
      const pts: string[] = [];
      const steps = 400;
      // top
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * W;
        const y = 6 + amp * Math.sin(freq * (i / steps) * Math.PI * 2 + phase);
        pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
      }
      // right
      for (let i = 0; i <= steps; i++) {
        const yy = (i / steps) * H;
        const x = W - 6 - amp * Math.sin(freq * (i / steps) * Math.PI * 2 + phase);
        pts.push(`L${x.toFixed(2)},${yy.toFixed(2)}`);
      }
      // bottom (reverse)
      for (let i = steps; i >= 0; i--) {
        const x = (i / steps) * W;
        const y = H - 6 - amp * Math.sin(freq * (i / steps) * Math.PI * 2 + phase);
        pts.push(`L${x.toFixed(2)},${y.toFixed(2)}`);
      }
      // left (reverse)
      for (let i = steps; i >= 0; i--) {
        const yy = (i / steps) * H;
        const x = 6 + amp * Math.sin(freq * (i / steps) * Math.PI * 2 + phase);
        pts.push(`L${x.toFixed(2)},${yy.toFixed(2)}`);
      }
      return pts.join(' ') + ' Z';
    }

    // Hipotrocoide para rosáceas dos cantos
    function hypPath(cx: number, cy: number, R: number, r: number, d: number, steps = 300): string {
      const pts: string[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 2 * r;
        const x = cx + (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
        const y = cy + (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
        pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(3)},${y.toFixed(3)}`);
      }
      return pts.join(' ') + ' Z';
    }

    // Estrela de N pontas
    function starPath(cx: number, cy: number, ro: number, ri: number, pts: number): string {
      const path: string[] = [];
      for (let i = 0; i < pts * 2; i++) {
        const angle = (i * Math.PI) / pts - Math.PI / 2;
        const r = i % 2 === 0 ? ro : ri;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        path.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(3)},${y.toFixed(3)}`);
      }
      return path.join(' ') + ' Z';
    }

    // Rosácea serrilhada (selo)
    function rosettePolygon(cx: number, cy: number, ro: number, ri: number, pts: number): string {
      return starPath(cx, cy, ro, ri, pts);
    }

    const U = 2.97; // 1U = 2.97mm = 1% da largura

    // Cantos das rosáceas (mm)
    const corners = [
      [6 + 5.4 * U * 0.5, 6 + 5.4 * U * 0.5],
      [W - 6 - 5.4 * U * 0.5, 6 + 5.4 * U * 0.5],
      [6 + 5.4 * U * 0.5, H - 6 - 5.4 * U * 0.5],
      [W - 6 - 5.4 * U * 0.5, H - 6 - 5.4 * U * 0.5],
    ];
    const cornerR = 5.4 * U * 0.5;

    const watermarkPaths = input.markAsTest ? `
      <g opacity="0.09">
        <path d="${hypPath(W / 2, H / 2, 28 * U, 11 * U, 7.7 * U, 600)}" fill="none" stroke="#b08d3c" stroke-width="0.5"/>
        <path d="${hypPath(W / 2, H / 2, 22 * U, 9 * U, 6.2 * U, 500)}" fill="none" stroke="#1b2a4a" stroke-width="0.35"/>
      </g>` : '';

    const cornerSvgs = corners.map(([cx, cy]) => `
      <circle cx="${cx}" cy="${cy}" r="${(cornerR + 1.5).toFixed(2)}" fill="#fbf7ee"/>
      <path d="${hypPath(cx, cy, cornerR * 0.92, cornerR * 0.37, cornerR * 0.49, 400)}"
            fill="none" stroke="#b08d3c" stroke-width="0.7" opacity="0.85"/>
      <circle cx="${cx}" cy="${cy}" r="${(cornerR * 0.18).toFixed(2)}" fill="#b08d3c" opacity="0.7"/>
    `).join('');

    const guillocheSvg = `
      <path d="${guillochePath(0,        1.4, 14)}" fill="none" stroke="#b08d3c" stroke-width="0.55" opacity="0.75"/>
      <path d="${guillochePath(Math.PI/3, 1.1, 11)}" fill="none" stroke="#1b2a4a" stroke-width="0.4"  opacity="0.45"/>
      <path d="${guillochePath(Math.PI,   1.6, 17)}" fill="none" stroke="#b08d3c" stroke-width="0.45" opacity="0.55"/>
      <path d="${guillochePath(Math.PI*2/3, 1.0, 9)}" fill="none" stroke="#1b2a4a" stroke-width="0.35" opacity="0.35"/>
      <path d="${guillochePath(Math.PI*4/3, 1.3, 13)}" fill="none" stroke="#b08d3c" stroke-width="0.4" opacity="0.5"/>
      <path d="${guillochePath(Math.PI*5/3, 0.9, 10)}" fill="none" stroke="#1b2a4a" stroke-width="0.3" opacity="0.3"/>
    `;

    // Brasão SVG (viewBox 100×100, exibido em 5.4U × 5.4U)
    const emblemSvg = `<svg viewBox="0 0 100 100" width="${(5.4*U).toFixed(1)}mm" height="${(5.4*U).toFixed(1)}mm" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="goldG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#e2c878"/>
          <stop offset="100%" stop-color="#b08d3c"/>
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="47" fill="none" stroke="#1b2a4a" stroke-width="2.5"/>
      <circle cx="50" cy="50" r="41" fill="none" stroke="url(#goldG)" stroke-width="1.5"/>
      <path d="${starPath(50, 50, 36, 30, 8)}" fill="url(#goldG)" opacity="0.9"/>
      <text x="50" y="56" text-anchor="middle" font-family="Georgia,serif" font-weight="700"
            font-size="18" fill="#1b2a4a" letter-spacing="1">${this.escape(initials)}</text>
    </svg>`;

    // Selo central SVG
    const sealSvg = `<svg viewBox="0 0 200 250" width="${(7*U).toFixed(1)}mm" height="${(8.75*U).toFixed(1)}mm" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sealGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#e2c878"/>
          <stop offset="100%" stop-color="#6f521a"/>
        </linearGradient>
        <linearGradient id="sealGold2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#b08d3c"/>
          <stop offset="100%" stop-color="#5c4413"/>
        </linearGradient>
      </defs>
      <!-- roseta serrilhada -->
      <path d="${rosettePolygon(100, 108, 92, 83, 40)}" fill="url(#sealGold)" opacity="0.95"/>
      <circle cx="100" cy="108" r="75" fill="none" stroke="url(#sealGold2)" stroke-width="1.2"/>
      <circle cx="100" cy="108" r="65" fill="#fbf7ee" stroke="url(#sealGold2)" stroke-width="1"/>
      <circle cx="100" cy="108" r="55" fill="none" stroke="#b08d3c" stroke-width="0.6" opacity="0.6"/>
      <!-- texto circular -->
      <path id="sealArc" d="M 28,108 A 72,72 0 1 1 172,108" fill="none"/>
      <text font-family="Georgia,serif" font-size="7.5" fill="#1b2a4a" letter-spacing="1.5">
        <textPath href="#sealArc" startOffset="50%" text-anchor="middle">
          CERTIFICADO AUTÊNTICO · ${this.escape(snapshot.institutionName.toUpperCase())} ·
        </textPath>
      </text>
      <!-- estrela central -->
      <path d="${starPath(100, 108, 28, 13, 5)}" fill="white" opacity="0.9"/>
      <text x="100" y="148" text-anchor="middle" font-family="Georgia,serif" font-size="10"
            fill="#6f521a" font-weight="700">${new Date().getFullYear()}</text>
      <!-- fitas -->
      <polygon points="55,195 100,205 145,195 155,240 100,230 45,240" fill="#6e1c27"/>
      <polygon points="75,195 100,202 125,195 130,235 100,226 70,235" fill="#86242f"/>
      <line x1="40" y1="196" x2="160" y2="196" stroke="#b08d3c" stroke-width="1.2"/>
    </svg>`;

    const testBanner = '';

    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;

  body {
    width: 297mm;
    min-height: 210mm;
    font-family: Georgia, 'Times New Roman', serif;
    background: radial-gradient(ellipse at center, #fbf7ee 40%, #efe5cf 100%);
    color: #1b2a4a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Página ── */
  .page {
    position: relative;
    width: 297mm;
    height: 210mm;
    overflow: hidden;
    page-break-after: always;
    background: radial-gradient(ellipse at center, #fbf7ee 40%, #efe5cf 100%);
  }

  /* ── Miolo ── */
  .inner {
    position: absolute;
    top: ${(7.2*U).toFixed(1)}mm;
    left: ${(8.4*U).toFixed(1)}mm;
    right: ${(8.4*U).toFixed(1)}mm;
    bottom: ${(7.3*U).toFixed(1)}mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  /* ── Cabeçalho ── */
  .inst-name {
    font-family: Georgia, serif;
    font-size: ${(1.05*U).toFixed(2)}mm;
    font-weight: 700;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: #1b2a4a;
    margin-top: ${(0.8*U).toFixed(2)}mm;
  }

  .cert-title {
    font-family: Georgia, serif;
    font-size: ${(5.3*U).toFixed(2)}mm;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: #1b2a4a;
    line-height: 1;
    margin-top: ${(1.2*U).toFixed(2)}mm;
  }

  .cert-sub {
    font-family: Georgia, serif;
    font-size: ${(0.78*U).toFixed(2)}mm;
    letter-spacing: 0.42em;
    text-transform: uppercase;
    color: #6f521a;
    margin-top: ${(0.5*U).toFixed(2)}mm;
    display: flex;
    align-items: center;
    gap: ${(1.5*U).toFixed(2)}mm;
  }
  .cert-sub-line {
    flex: 1;
    height: 0.4mm;
    background: linear-gradient(to right, transparent, #b08d3c);
  }
  .cert-sub-line.rev {
    background: linear-gradient(to left, transparent, #b08d3c);
  }

  /* ── Corpo ── */
  .certifies-label {
    font-family: Georgia, serif;
    font-style: italic;
    font-size: ${(1.0*U).toFixed(2)}mm;
    color: #3c4764;
    margin-top: ${(1.6*U).toFixed(2)}mm;
  }

  .student-name {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: ${(5.6*U).toFixed(2)}mm;
    font-weight: 700;
    font-style: italic;
    color: #22335c;
    line-height: 1.05;
    border-bottom: 1px solid #b08d3c;
    padding-bottom: ${(0.6*U).toFixed(2)}mm;
    margin-top: ${(0.4*U).toFixed(2)}mm;
    max-width: ${(80*U).toFixed(1)}mm;
    white-space: nowrap;
    overflow: hidden;
  }

  .body-text {
    font-family: Georgia, serif;
    font-size: ${(1.05*U).toFixed(2)}mm;
    line-height: 1.7;
    color: #2a3550;
    max-width: ${(74*U).toFixed(1)}mm;
    margin-top: ${(1.0*U).toFixed(2)}mm;
  }
  .body-text strong { color: #1b2a4a; }

  .date-city {
    font-family: Georgia, serif;
    font-style: italic;
    font-size: ${(0.92*U).toFixed(2)}mm;
    color: #45506a;
    margin-top: ${(0.8*U).toFixed(2)}mm;
  }

  /* ── Assinaturas + Selo ── */
  .sig-row {
    margin-top: auto;
    width: 100%;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: end;
    gap: ${(2*U).toFixed(1)}mm;
    padding-top: ${(1*U).toFixed(1)}mm;
  }

  .sig-block {
    text-align: center;
  }
  .sig-script {
    font-family: Georgia, serif;
    font-style: italic;
    font-size: ${(2.2*U).toFixed(2)}mm;
    color: #22335c;
    transform: rotate(-4deg) translateY(${(0.6*U).toFixed(2)}mm);
    display: block;
    white-space: nowrap;
  }
  .sig-line-hr {
    border: none;
    border-top: 0.4mm solid #1b2a4a;
    margin: ${(0.3*U).toFixed(2)}mm 0 ${(0.4*U).toFixed(2)}mm;
  }
  .sig-full-name {
    font-family: Georgia, serif;
    font-weight: 700;
    font-size: ${(0.85*U).toFixed(2)}mm;
    color: #1b2a4a;
    letter-spacing: 0.04em;
  }
  .sig-role-text {
    font-family: Georgia, serif;
    font-style: italic;
    font-size: ${(0.75*U).toFixed(2)}mm;
    color: #3c4764;
    margin-top: 0.5mm;
  }

  /* ── Rodapé ── */
  .page-footer {
    position: absolute;
    bottom: ${(3.5*U).toFixed(1)}mm;
    left: ${(8.4*U).toFixed(1)}mm;
    right: ${(8.4*U).toFixed(1)}mm;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    font-family: 'Courier New', monospace;
    font-size: ${(0.62*U).toFixed(2)}mm;
    color: #45506a;
  }
  .footer-reg { line-height: 1.5; }
  .ver-block {
    display: flex;
    gap: ${(0.8*U).toFixed(2)}mm;
    align-items: flex-end;
    text-align: left;
    max-width: ${(38*U).toFixed(1)}mm;
  }
  .ver-qr {
    width: ${(5.6*U).toFixed(1)}mm;
    height: ${(5.6*U).toFixed(1)}mm;
    flex-shrink: 0;
    border: 0.4mm solid #b08d3c;
    padding: 0.3mm;
    background: #fbf7ee;
  }
  .ver-info { line-height: 1.6; word-break: break-all; }
  .ver-url  { color: #3c4764; }
  .ver-code { font-weight: 700; color: #1b2a4a; }
</style>
</head>
<body>

${testBanner}

<!-- ══════════════════ FRENTE ══════════════════ -->
<div class="page">

  <!-- Moldura SVG de fundo -->
  <svg style="position:absolute;top:0;left:0;width:297mm;height:210mm;overflow:visible;"
       viewBox="0 0 297 210" xmlns="http://www.w3.org/2000/svg"
       preserveAspectRatio="none">
    <defs>
      <linearGradient id="gfInst" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stop-color="#b08d3c" stop-opacity="0"/>
        <stop offset="50%"  stop-color="#b08d3c" stop-opacity="1"/>
        <stop offset="100%" stop-color="#b08d3c" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <!-- borda externa navy -->
    <rect x="5" y="5" width="287" height="200" rx="1" ry="1"
          fill="none" stroke="#1b2a4a" stroke-width="0.6"/>
    <!-- borda interna gold -->
    <rect x="7" y="7" width="283" height="196" rx="0.5" ry="0.5"
          fill="none" stroke="#b08d3c" stroke-width="0.3"/>
    <!-- guilloché -->
    ${guillocheSvg}
    <!-- marca d'água central -->
    ${watermarkPaths}
    <!-- rosáceas de canto -->
    ${cornerSvgs}
  </svg>

  <!-- Conteúdo principal -->
  <div class="inner">

    <!-- Brasão -->
    ${emblemSvg}
    <div class="inst-name">${this.escape(snapshot.institutionName)}</div>

    <!-- Título -->
    <div class="cert-title">CERTIFICADO</div>
    <div class="cert-sub">
      <div class="cert-sub-line rev"></div>
      de conclusão de curso
      <div class="cert-sub-line"></div>
    </div>

    <!-- Corpo -->
    <div class="certifies-label">Certificamos que</div>

    <div class="student-name" id="studentName">${this.escape(snapshot.studentName)}</div>

    <p class="body-text">
      concluiu com êxito o curso livre de
      <strong>${this.escape(snapshot.courseTitle)}</strong>,
      na modalidade ${modeLabel}, com carga horária de
      <strong>${snapshot.workloadHours} horas</strong>,
      concluído em ${completionFormatted}.
    </p>

    <div class="date-city">${completionFormatted}.</div>

    <!-- Assinaturas + Selo -->
    <div class="sig-row">
      <div class="sig-block">
        <span class="sig-script">${this.escape(sigScript)}</span>
        <hr class="sig-line-hr">
        <div class="sig-full-name">${this.escape(responsibleName)}</div>
        <div class="sig-role-text">${this.escape(responsibleRole)}</div>
      </div>

      <div style="text-align:center;">${sealSvg}</div>

      <div class="sig-block">
        <span class="sig-script">${this.escape(snapshot.institutionName.split(' ')[0])}</span>
        <hr class="sig-line-hr">
        <div class="sig-full-name">${this.escape(snapshot.institutionName)}</div>
        <div class="sig-role-text">Instituição Emissora</div>
      </div>
    </div>

  </div><!-- /.inner -->

  <!-- Rodapé -->
  <div class="page-footer">
    <div class="footer-reg">
      Registro nº ${this.escape(input.registrationNumber)}<br>
      Código: <strong style="color:#1b2a4a;">${this.escape(input.verificationCode)}</strong>
    </div>
    <div class="ver-block">
      <img class="ver-qr" src="${qrCode}" alt="QR verificação">
      <div class="ver-info">
        <div>Verifique a autenticidade em:</div>
        <div class="ver-url">${this.escape(input.verificationUrl)}</div>
        <div class="ver-code">${this.escape(input.verificationCode)}</div>
      </div>
    </div>
  </div>

</div><!-- /.page -->

<script>
  // Encolhe o nome do aluno para caber em 1 linha
  document.fonts.ready.then(() => {
    const el = document.getElementById('studentName');
    if (el) {
      const parent = el.parentElement;
      let fs = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > el.clientWidth && fs > fs * 0.30) {
        fs -= 0.5;
        el.style.fontSize = fs + 'px';
      }
    }
    document.body.dataset.ready = '1';
  });
</script>

</body>
</html>`;
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return entities[character];
    });
  }
}
