# Matrix CLI — Product Requirements Document (PRD)

> **Versiyon:** 1.2 (Final, Product-Ready Beta Addendum)
> **Tarih:** 2026-02-16
> **Durum:** 🔒 KİLİTLİ

---

## 1. Vizyon & Misyon

### 1.1 Vizyon

Matrix, bir "komut satırı chatbot" değil; terminalde çalışan, güvenli ve gözlemlenebilir bir **Agentic Development Runtime**'dır. Geliştiricinin tek bir akışta **PRD → Plan → Onay → Implement → QA → Review → Refactor → PR** ilerlemesini sağlar.

### 1.2 Misyon

Üç paradigmanın en güçlü yönlerini tek bir üründe birleştirmek:

| Paradigma | İlham Kaynağı | Matrix'e Katkısı |
|---|---|---|
| **Konuşma tabanlı akış** | Claude Code | Doğal dil ile dosya yönetimi, `/` komut ergonomisi, uzun bağlam desteği |
| **Komut çevirisi & hız** | Codex CLI | Event-driven yürütme, şeffaf adım akışı, terminal hakimiyeti |
| **Otonom yürütme** | OpenCode / OpenHands | Kendi kendine iyileştirme döngüsü (Reflexion), çok aşamalı görev yönetimi |

### 1.3 Hedef

Terminalde **hızlı**, **kontrolllü**, **güvenli**, **tekrarlanabilir** ve **yüksek kaliteli** yazılım üretimini standartlaştırmak. Geliştiriciyi kod hamallığından kurtarıp, gerçek bir sistem mimarı rolüne yükseltmek.

---

## 2. Temel İlkeler (Product DNA — Non-Negotiables)

1. **Plan Lock Disiplini:** Plan onaylanmadan write/exec kapalıdır. Plan Agent planı tamamladıktan sonra doğal dil ile onay ister; `/plan approve` gibi komutlar zorunlu değildir.
2. **İnsan Kontrolü:** Her write/exec işleminden önce diff preview zorunludur. Riskli işlemlerde policy block devreye girer. Kullanıcı her zaman "Kapı Bekçisi"dir (Gatekeeper).
3. **Context Ölçeklenebilirliği:** "Her şeyi prompt'a basmak" yoktur. Hiyerarşik bağlam keşfi (CodeRLM yaklaşımı) ile sadece gerekli içerik çekilir. Bağlam kullanımını %90'a kadar azaltma hedefi vardır.
4. **Gözlemlenebilirlik:** Her tool çağrısı, model çağrısı, diff ve test sonucu event stream + run log olarak kaydedilir. Replay ve audit zorunludur.
5. **Güvenli Anahtar Yönetimi:** Provider key'ler daima yerelde saklanır; backend'e asla gönderilmez.
6. **Claude Code Uyumluluğu:** `/` komutları ve davranışları Claude Code ile mümkün olduğunca aynıdır; ek komutlar compat'i bozmaz.
7. **Local-first, Hybrid İş Modeli:** CLI yerelde çalışır; Matrix hesabı/entitlement opsiyoneldir (team policy, audit, dağıtım).
8. **Cross-platform:** Windows / macOS / Linux first-class desteklenir; entegrasyonlar graceful-degrade çalışır.

### 2.1 İlke Doğrulama ve İhlal Sonucu

| İlke | Doğrulama Yöntemi | İhlal Sonucu |
|---|---|---|
| Plan Lock | `AWAITING_PLAN_CONFIRMATION` durumunda write/exec girişimlerinin entegrasyon testleri | `policy.block` + durum geçişi engeli + kullanıcıya gerekçe |
| İnsan Kontrolü | Diff önizleme ve onay event zinciri (`diff.proposed -> diff.approved/rejected`) | İşlem durdurulur, diff uygulanmaz |
| Context Ölçeklenebilirliği | Token bütçe denetimi + context hit benchmark | Çağrı özetleme fallback'i ile devam, ihlal loglanır |
| Gözlemlenebilirlik | Event şeması zorunlu alan validasyonu | Eksik event durumunda run `error` ile işaretlenir |
| Güvenli Anahtar Yönetimi | Secret redaction + vault erişim testleri | Anahtar içeren payload bloklanır, log redaction zorunlu |
| Claude Compat | Komut davranış karşılaştırma testi | Compat sapması release gate'de fail olur |
| Local-first | Ağ kesintisinde yerel mod smoke test | Entitlement dışı yerel işlevler çalışmaya devam eder |
| Cross-platform | OS matrix CI (Windows/macOS/Linux) | Platform-specific bug P1 olarak açılır |

---

## 3. Kullanıcı Hikayeleri & Senaryolar

### 3.1 PRD'den Ürüne (Ana Akış)

```
Kullanıcı PRD yapıştırır
    → Matrix PRD'yi analiz eder, boşlukları bulur
    → Plan Agent soru sorar, kullanıcıyla birlikte netleştirir
    → Plan Agent uygulanabilir plan çıkarır (milestone + kabul kriteri + risk)
    → "Planı onaylıyorsan başlayabilirim. onayla/başla/evet yaz."
    → Kullanıcı onaylar
    → Builder Agent implement eder, diff'ler gösterir, testleri koşar
    → QA → Review → Refactor döngüleri
    → Sonuç: Çalışan özellik + test + dokümantasyon + PR
```

### 3.2 Hızlı Fix

- Kullanıcı: "Bu hata neden oluyor? Fixle."
- Matrix ilgili logları/stack trace'i alır
- Plan Agent mini-plan çıkarır (kısa)
- Onay → Builder uygular → QA doğrular

### 3.3 Büyük Refactor

- Kullanıcı: "Auth modülünü hexagonal mimariye geçir."
- Plan Agent risk/etki analizi yapar
- Milestone bazlı refactor planı + rollback stratejisi
- Onay → Refactor + Review agent'ları iteratif uygular

### 3.4 Exploratif Sorgulama

- Kullanıcı: "Bu projenin kimlik doğrulama mantığı nasıl çalışıyor?"
- Context Engine semantik arama yapar (AST + doküman RAG)
- İlgili dosyaları, fonksiyon imzalarını ve akışları özetler
- Write/exec tetiklenmez

---

## 4. Ürün Özellikleri

### 4.1 Komut Sistemi (Claude Code Uyumlu)

Matrix'in `/` komutları Claude Code ile aynı isimlerde ve benzer davranışlarda olmalıdır.

#### Session Komutları

| Komut | Açıklama |
|---|---|
| `/new` | Yeni oturum başlat |
| `/resume` | Önceki oturumu devam ettir |
| `/fork` | Mevcut oturumdan dal oluştur |
| `/export` | Oturumu dışa aktar |
| `/import` | Oturumu içe aktar |
| `/clear` | Bağlam temizle (safe) |

#### Proje & Context Komutları

| Komut | Açıklama |
|---|---|
| `/init` | Proje için Matrix dosyalarını oluştur (`MATRIX.md`, `AGENTS.md`, `.matrix/`) |
| `/status` | Repo durumu, değişiklikler, plan durumu |
| `/context` | Bağlam politikası, dahil edilen dosyalar |
| `/context find "..."` | Semantik bağlam araması |
| `/context explain <file>` | Dosya özeti + önemli semboller |
| `/rules` | Proje kuralları (`MATRIX.md`) görüntüle/düzenle |
| `/context policy` | Bağlam politikası yönetimi |

#### Agent & Workflow Komutları

| Komut | Açıklama |
|---|---|
| `/plan` | PRD/istek üzerinden plan aşamasına geç |
| `/build` | Uygulama aşamasına geç (plan onayı varsa) |
| `/qa` | Test/QA döngüsü başlat |
| `/review` | Kod inceleme döngüsü |
| `/refactor` | Refactor döngüsü |
| `/stop` | Ajanı durdur |

#### Model / Auth Komutları

| Komut | Açıklama |
|---|---|
| `/model` | Aktif model seç veya model listele |
| `/auth` | Login / plan / keys |
| `/quota` | Plan limitleri ve kullanım |
| `/telemetry` | Telemetry modu ve privacy tercihleri |

#### Tool / MCP / Sandbox Komutları

| Komut | Açıklama |
|---|---|
| `/tools` | Mevcut araçları listele |
| `/mcp` | MCP sunucularını yönet |
| `/approval` | Onay modu değiştir (`strict` / `balanced` / `fast`) |
| `/sandbox` | Güvenlik politikası yönetimi |

#### Shell CLI Komutları (`matrix ...`)

| Komut | Açıklama |
|---|---|
| `matrix init` | `.matrix/` ve proje dosyalarını oluştur |
| `matrix run` | TUI'yi başlat (veya headless mod) |
| `matrix auth login\|logout\|status` | Hesap yönetimi |
| `matrix auth add <provider>` | Provider key'i yerelde sakla |
| `matrix auth plans` | Satın alınan planları listele |
| `matrix doctor` | Environment/permission kontrolü |
| `matrix doctor --json` | Makine-okunur sağlık raporu üret |
| `matrix telemetry status\|enable\|minimal\|disable` | Telemetry tercihini yönet |
| `matrix update [--channel <alpha\|beta\|stable>]` | Sürüm güncelleme kanalı yönetimi |
| `matrix update --rollback` | Son güvenli sürüme geri dön |
| `matrix status --service` | Servis/incident durumu göster |
| `matrix export-run <runId>` | Run log dışa aktarımı (redacted) |

### 4.2 Doğal Dil Onay Akışı (Komutsuz Plan Onayı)

Plan Agent planı bitirdikten sonra sistem otomatik olarak **`AWAITING_PLAN_CONFIRMATION`** durumuna geçer.

**Onay beklerken:**
- Kod yazma / exec kapalıdır
- Sadece plan revizyonu ve soru-cevap açıktır

**Intent sınıfları (zorunlu):**

| Intent | Örnek ifadeler | Durum etkisi |
|---|---|---|
| `approve` | `onayla`, `başla`, `evet`, `tamam başla`, `devam`, `ok`, `go`, `approve`, `start` | `IMPLEMENTING` durumuna geçiş |
| `revise` | `şunu değiştir`, `revize et`, `kapsamı daralt`, `milestone 2'yi çıkar` | Plan revizyon döngüsü, durum korunur |
| `ask` | `neden böyle`, `alternatif ne`, `risk ne` | Soru-cevap, durum korunur |
| `deny` | `hayır`, `iptal`, `şimdilik başlamayalım` | Plan uygulanmaz, durum korunur |

**Intent confidence sözleşmesi:**
- `confidence >= 0.85`: intent doğrudan uygulanır (çelişen sinyal yoksa).
- `0.60 <= confidence < 0.85`: sistem explicit teyit ister: `Bunu onay olarak algıladım, devam edeyim mi? (evet/hayır)`.
- `confidence < 0.60`: durum değişimi yapılmaz; kullanıcıdan net ifade istenir.

**Çelişki çözüm kuralı:**
- Aynı mesajda hem `approve` hem `revise` sinyali varsa `revise` önceliklidir.
- Aynı mesajda hem `approve` hem `deny` sinyali varsa `deny` önceliklidir.
- Belirsiz durumda varsayılan aksiyon daima `no-op` (yani write/exec yok) olur.

**Komut fallback (compat):**
- Doğal dil onayı esastır.
- Yanlış anlama riski için kullanıcı isterse explicit komutla ilerleyebilir: `/plan approve` veya `/plan revise`.

**TUI Kısayolları (opsiyonel):**
- `Enter` = Başla
- `r` = Revize
- `q` = Soru
### 4.3 Auth & Plan Satın Alma Modeli

Matrix iki katmanlı auth tasarımı kullanır:

#### A) Matrix Hesabı (Login)

Kullanıcı Matrix hesabıyla CLI'da oturum açar. Matrix backend:
- Kullanıcının satın aldığı **coding plan** bilgilerini
- Model erişim yetkilerini (entitlements)
- Kullanım limitlerini
- Faturalama/abonelik durumunu tutar

#### B) Provider Key Vault (Yerel)

- Kullanıcı, provider'ın verdiği API key'i **yerelde** saklar
- Öncelik: OS Keychain (Keytar)
- Keychain yoksa: `~/.matrix/keys.enc` (libsodium ile şifreli)
- Key'ler asla Matrix backend'e gönderilmez

**Örnek akış:**
```
1. matrix auth login          → Matrix hesabıyla giriş
2. matrix auth plans          → Satın alınan planları gör
3. matrix auth add openai     → OpenAI API key'ini yerelde sakla
4. /model gpt-5.3-codex       → Modeli seç ve kullanmaya başla
```

### 4.4 Desteklenen Modeller (v1)

| Model | Provider |
|---|---|
| `gpt-5.3-codex` | OpenAI |
| `glm-5` | GLM |
| `minimax-2.5` | MiniMax |
| `kimi-k2.5` | Kimi |

**Model Gateway hedefi:** Tüm provider'ları tek bir `Chat + Tools` arayüzü altında normalize etmek.

### 4.5 Matrix TUI (Terminal Arayüzü)

**Hedef:** Terminalde modern, okunabilir, hızlı ve "Matrix" hissi veren arayüz.

#### Tasarım İlkeleri

| Öğe | Değer |
|---|---|
| **Ana renk** | Neon yeşil (#00FF41) |
| **Zemin** | Koyu gri/siyah |
| **Akış** | Token-streaming + event stream |
| **Efekt** | Minimal "falling glyph" efekti (okunurluğu bozmayacak düzeyde) |

#### Panel Düzeni

```
┌──────────────┬───────────────────────────┬──────────────┐
│  SOL PANEL   │       ORTA PANEL          │  SAĞ PANEL   │
│              │                           │              │
│ • Oturum     │  Chat + Streaming Output  │ • File Tree  │
│ • Agent      │  Kod Blokları             │ • Diff       │
│   State      │  A2UI Bileşenleri         │   Preview    │
│ • Task List  │                           │              │
│              │                           │              │
├──────────────┴───────────────────────────┴──────────────┤
│  ALT PANEL: Input Bar | Model | Approval Mode | Tokens  │
└─────────────────────────────────────────────────────────┘
```

#### Diff UX (Kritik)

- Her write öncesi **diff preview** zorunlu
- **Hunk-level review:** Kullanıcı tüm diff'i değil, belirli satır/blokları seçerek kabul veya red edebilir
- Aksiyonlar: `Approve` / `Edit` / `Reject` / `Approve Hunk` / `Reject Hunk`
- `Rollback`: Son diff'i geri al

#### Üretken Arayüz (Generative UI — v0.2+)

A2UI protokolü ile ajan sadece metin değil, arayüz bileşenleri de üretebilir:
- Kontrol listesi (checklist), onay formu, tablo, bar grafik vb.
- Deklaratif JSON şeması → React Ink render
- Güvenli: Yürütülebilir kod içermez, XSS riski yok

---

## 5. Ajanlar (Agents) ve Sorumlulukları

Matrix'te iş akışı "agent team" mantığıyla ilerler. Her ajan kendi profesyonel system prompt'una sahiptir.

### 5.1 Agent Listesi

#### 1. Plan Agent (Mimar)

**Sorumluluklar:**
- PRD'yi analiz eder, kritik boşlukları bulur
- Netleştirici sorular sorar
- Kapsamı kilitler, scope in/out belirler
- Milestone bazlı roadmap çıkarır (DAG yapısında)
- Risk analizi + mitigation stratejileri üretir
- Kullanıcıdan doğal dil ile onay ister

**Model tercihi:** Yüksek akıl yürütme kapasiteli model (reasoning tier)

#### 2. Builder Agent (Kodlayıcı)

**Sorumluluklar:**
- Onaylanan planı uygular
- Kod yazar, tool'ları çalıştırır
- Diff'ler üretir
- Her adımda event stream yayınlar

**Model tercihi:** Hızlı / maliyet-etkin codegen modeli

#### 3. QA Agent (Test Mühendisi)

**Sorumluluklar:**
- Test stratejisi çıkarır
- Edge-case ve regresyon testleri yazar
- Testleri çalıştırır (sandbox içinde)
- Hata raporları üretir
- **Reflexion döngüsü:** Test başarısızsa → hata analizi → Builder'a geri bildirim → düzeltme → tekrar test (max\_retries kadar)

**Model tercihi:** Codegen modeli

#### 4. Review Agent (Denetçi)

**Sorumluluklar:**
- Kod kalitesi değerlendirmesi
- Mimari tutarlılık kontrolü
- Güvenlik denetimi
- Performans analizi
- Maintainability skoru

**Model tercihi:** Yüksek akıl yürütme kapasiteli model (opsiyonel: yerel model ile gizlilik)

#### 5. Refactor Agent

**Sorumluluklar:**
- Teknik borç azaltma
- Modülerlik iyileştirme
- Okunabilirlik artırma
- Tekrar eden kodu azaltma (DRY)

**Model tercihi:** Codegen modeli

### 5.2 Agent System Prompt Şablonu

Her ajanın prompt'u şu bloklarla standartlaştırılır:

1. **Role & Mission** — Ajanın kimliği ve görevi
2. **Success Criteria** — Ölçülebilir başarı kriterleri
3. **Constraints** — Repo kuralları, style guide, `MATRIX.md`
4. **Tool Policy** — Read/write/exec koşulları + onay kuralları
5. **Output Contract** — Çıktı formatı + kontrol listesi
6. **Failure Modes** — Belirsizlikte ne yapacağı (soru sor, varsayım yaz)

### 5.3 Plan Agent Output Contract

Plan Agent her zaman şu formatı üretir:

```
├── PRD Özeti (1 sayfa)
├── Açık Sorular & Cevaplar
├── Scope
│   ├── In-scope
│   └── Out-of-scope
├── Milestones (M1..Mn)
│   └── Her milestone: deliverable + acceptance criteria
├── Riskler & Mitigations
├── Varsayımlar
└── Başlama Sorusu:
    "Planı onaylıyorsan başlayabilirim. onayla/başla/evet yaz."
```

### 5.4 Reflexion (Yansıtma) Döngüsü

Kendi kendine iyileştirme mekanizması:

```
Builder kodu yazar
    → QA Agent testleri çalıştırır (Sandbox)
    → TEST BAŞARILI → devam
    → TEST BAŞARISIZ →
        → Hata çıktısı + orijinal kod → Review Agent'a gönderilir
        → Review Agent "Neden başarısız?" analizi yapar
        → Düzeltme stratejisi önerir
        → Builder kodu günceller
        → max_retries'a kadar döngü tekrarlanır
```

---

## 6. Workflow ve Durum Makinesi (State Machine)

### 6.1 Durum Diyagramı

```
PRD_INTAKE
    │
    ▼
PRD_CLARIFYING ←──── (soru varsa)
    │
    ▼
PLAN_DRAFTED
    │
    ▼
AWAITING_PLAN_CONFIRMATION ←──── (revizyon varsa)
    │ (onay gelince)
    ▼
IMPLEMENTING
    │
    ▼
QA ←────────────────── (test fail → reflexion loop)
    │
    ▼
REVIEW
    │
    ▼
REFACTOR (opsiyonel)
    │
    ▼
DONE
```

### 6.2 Durum Kuralları

| Durum | Write/Exec | Açık Olan |
|---|---|---|
| `PRD_INTAKE` | ❌ | Chat, analiz |
| `PRD_CLARIFYING` | ❌ | Soru-cevap, netleştirme |
| `PLAN_DRAFTED` | ❌ | Plan inceleme |
| `AWAITING_PLAN_CONFIRMATION` | ❌ | Plan revizyonu, soru-cevap |
| `IMPLEMENTING` | ✅ | Tam yetki (onaylı) |
| `QA` | ✅ (test) | Test çalıştırma, hata raporu |
| `REVIEW` | ❌ | Kod inceleme, öneriler |
| `REFACTOR` | ✅ | Kodu yeniden yapılandırma |
| `DONE` | ❌ | Özet, PR hazırlığı |

### 6.3 Event Stream (Codex Benzeri Olay Akışı)

Her run için event'ler akışta gösterilir ve disk'e (redacted) yazılır.

#### Event Envelope v1 (zorunlu alanlar)

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `eventVersion` | string | ✅ | Şema sürümü (`v1`) |
| `runId` | string | ✅ | Tekil run kimliği |
| `eventId` | string | ✅ | Tekil event kimliği |
| `timestamp` | string (ISO-8601) | ✅ | UTC zaman damgası |
| `state` | enum | ✅ | O anki workflow durumu |
| `actor` | enum | ✅ | `user`, `plan_agent`, `builder_agent`, `qa_agent`, `review_agent`, `system` |
| `type` | string | ✅ | Event tipi |
| `correlationId` | string | ✅ | Aynı işlem zincirini ilişkilendirme |
| `payload` | object | ✅ | Event'e ait veri |
| `redactionLevel` | enum | ✅ | `none`, `partial`, `strict` |

#### Event tipleri

| Event | Açıklama |
|---|---|
| `turn.start` / `turn.end` | Tur başlangıcı/bitişi |
| `agent.start` / `agent.stop` | Ajan aktivasyonu |
| `model.call` / `model.result` | LLM çağrısı ve yanıtı |
| `tool.call` / `tool.result` | Tool çağrısı ve sonucu |
| `diff.proposed` | Diff önerildi |
| `diff.hunk.approved` / `diff.hunk.rejected` | Hunk bazlı karar |
| `diff.approved` / `diff.rejected` | Diff tamamı onayı/reddi |
| `diff.applied` / `diff.rolled_back` | Diff uygulama/geri alma |
| `policy.warn` / `policy.block` | Policy uyarısı/engeli |
| `test.run` / `test.result` | Test çalıştırma ve sonucu |
| `checkpoint.saved` / `checkpoint.restored` | Checkpoint işlemleri |
| `error` | Hata |

#### Kalıcılık ve replay sözleşmesi

- Event sırası `timestamp` + `eventId` ile deterministik olarak tekrar üretilebilir olmalıdır.
- Redacted export (`matrix export-run <runId>`) çıktısı kişisel verileri ve secret'ları maskeler.
- `payload` içindeki secret tespiti durumunda event otomatik `redactionLevel=strict` olarak yazılır.
### 6.4 Durum Kalıcılığı ve Checkpoint

- Her durum geçişi ve event yerel veritabanına (SQLite) kaydedilir
- Kullanıcı terminali kapatsa bile oturum ve görevler korunur
- **Checkpoint:** İş akışının her kritik adımında durum kaydedilir
- **Undo / Time Travel (v0.2+):** Yanlış adım sonrası önceki checkpoint'e dönüş imkanı

---

## 7. Tool Runtime (Dosya / Komut / Repo Araçları)

### 7.1 Yerleşik Tool'lar

| Tool | Açıklama | İzin Seviyesi |
|---|---|---|
| `fs_read` | Dosya okuma | Auto (hassas dosyalar hariç) |
| `fs_write` | Dosya yazma | Onay gerekli |
| `patch_apply` | Diff uygula | Onay gerekli |
| `search` | Ripgrep/grep ile arama | Auto |
| `git_ops` | status, diff, commit, branch | Onay gerekli (write ops) |
| `exec` | Komut çalıştırma | Onay gerekli |
| `test_runner` | Framework bazlı test koşumu | Balanced'da auto |
| `formatter` | Proje config'ine göre formatlama | Auto |
| `linter` | Lint çalıştır ve raporla | Auto |
| `http_fetch` | Docs çekme (opsiyonel) | Onay gerekli |

### 7.2 Güvenli Araç Yürütme

- Ajan doğrudan shell komutu üretmek yerine, önceden tanımlanmış **Safe Tools** kullanır
- `fs_write` aracı: Dosya yolunun proje sınırları içinde olduğunu doğrular (path traversal koruması)
- Her write öncesi dosyanın yedeği alınır
- Kod değişikliği sonrası otomatik linter çalıştırılır → hata varsa ajana raporlanır

### 7.3 Onay (Approval) Modları

| Mod | Davranış | Risk Seviyesi |
|---|---|---|
| `strict` | Her write/exec için onay sor | 🟢 En güvenli |
| `balanced` (default) | Write/exec sor; read serbest | 🟡 Önerilen |
| `fast` | Allowlist ile oto-onay; riskli olanlar sor | 🔴 İleri kullanıcı |

### 7.4 Write/Exec Pipeline (Güvenlik Zincirleme)

Her write/exec işlemi şu deterministik pipeline'dan geçer:

```
Builder "proposed action" üretir (diff veya komut)
    │
    ▼
Action Normalize (hedef dosya/komut/parçalar kanonikleştirilir)
    │
    ▼
Guardian Gate (secret/risk taraması)
    │
    ▼
Policy Engine (path/command/tool izin kararı)
    │
    ▼
Kullanıcı Onayı (diff preview + hunk-level karar)
    │
    ▼
Execute
    │
    ▼
Post-Checks (formatter/linter/test)
    │
    ▼
Event Log + Checkpoint
```

#### Karar semantiği

| Karar | Anlam | Sonraki adım |
|---|---|---|
| `allow` | Risk yok | Pipeline devam |
| `warn` | Risk düşük, bilgi ver | Kullanıcıya uyarı + devam |
| `needs_approval` | İnsan kararı gerekli | Onay bekleme |
| `block` | Güvenlik/policy ihlali | Anında durdurma |

**Öncelik:** `block > needs_approval > warn > allow`

#### Formatter/Linter uyum kuralı

- `autoLintOnWrite=true` olduğunda linter sadece rapor üretir; dosya mutasyonu yapmaz.
- Formatter dosya değiştiriyorsa bu değişiklik **yeni diff** olarak sunulur ve aynı onay zincirinden yeniden geçer.
- Böylece "her write öncesi diff/onay" ilkesi korunur.

---
## 8. Context Engine (Bağlam Motoru)

### 8.1 Amaç

Büyük projelerde (100K+ satır) ilgili dosyaları otomatik bulup bağlama dahil etmek — gereksiz bilgi eklemeden, token bütçesini verimli yönetmek.

### 8.2 Hiyerarşik Bağlam Keşfi (CodeRLM)

Ajan tüm kodu bir anda okumak yerine, kademe kademe keşfeder:

| Adım | İşlem | Bağlam Maliyeti |
|---|---|---|
| **1. `explore_structure`** | Sadece dosya/klasör ağacını gör | Çok düşük |
| **2. `list_definitions`** | Dosyadaki sembol listesi (fonksiyon isimleri) | Düşük |
| **3. `read_interface`** | Fonksiyon imzası + docstring (gövde gizli) | Orta |
| **4. `read_implementation`** | Sadece gerekli fonksiyonun gövdesi | Yüksek |

**Sonuç:** Bağlam kullanımında %90'a varan azalma.

### 8.3 Anlamsal Budama (Semantic Pruning)

Bağlam penceresine dosya eklendiğinde:

1. **Odak belirleme:** Kullanıcı sorgusu veya ajanın çalıştığı fonksiyon
2. **AST analizi:** Tree-sitter ile odak noktası korunur
3. **Katlama:** Alakasız fonksiyonlar, import'lar → `//... (other methods folded)`
4. **Bağımlılık ekleme:** Odak fonksiyonun çağırdığı fonksiyonların sadece imzaları eklenir

### 8.4 Yapısal İndeksleme (Tree-sitter)

| Bileşen | Açıklama |
|---|---|
| **Sembol Tablosu** | Her dosya için: sınıflar, fonksiyonlar, değişkenler + satır aralıkları |
| **Referans Grafı** | Call graph + inheritance graph → etki analizi |
| **Dosya İzleme** | File watching ile değişen dosyalar anında yeniden parse |
| **Hata Toleransı** | Geçici sözdizimi hatalarında bile çalışmaya devam |

### 8.5 Hibrit Arama Stratejisi

| Arama Tipi | Yöntem | Kullanım Alanı |
|---|---|---|
| **Kod navigasyonu** | AST + Sembolik navigasyon (Tree-sitter) | Fonksiyon bulma, etki analizi, refactor |
| **Lexical arama** | Ripgrep + heuristics | Pattern arama, log/string bulma |
| **Kavramsal arama** | Vektör tabanlı RAG (v0.2+) | "Bu proje auth'u nasıl yapıyor?" gibi sorular |

### 8.6 Context Budget & Cache

- **Token bütçesi:** Her model çağrısı öncesi bağlam boyutu hesaplanır ve limit aşımı engellenir.
- **Soft limit:** Sağlayıcı pencere limitinin `%70` seviyesinde özetleme/sıkıştırma devreye alınır.
- **Hard limit:** Sağlayıcı pencere limitinin `%90` seviyesinde çağrı bloklanır ve fallback stratejisi uygulanır (`summary -> selective-read -> ask-user`).
- **Cache:** Dosya okuma, parse ve summary sonuçları `content-hash` ile saklanır; ikinci istekte cache'den döner.
- **Özet:** Büyük dosyalar chunking + özetleme ile bağlama dahil edilir.

#### Performans ve kalite hedefleri (v0.1)

| Metrik | Hedef |
|---|---|
| Context assemble latency (warm, p95) | `<= 2.0s` |
| Context assemble latency (cold, p95) | `<= 5.0s` |
| Cache hit rate (tekrarlayan görevlerde) | `>= 60%` |
| Context hit rate (ilgili dosya yakalama) | `>= 85%` |
| Token tasarrufu (baseline'a göre) | `>= 50%` (stretch: `%90`) |
### 8.7 Context Komutları

```
/context                    → Mevcut bağlam politikası + dahil edilen dosyalar
/context find "user auth"   → Semantik bağlam araması
/context explain <file>     → Dosya özeti + önemli semboller
/context policy             → Bağlam politikası düzenle
auto-context                → Ajan yalnız gerekli dosyaları otomatik çeker
```

---

## 9. Model Gateway & Smart Router

### 9.1 Model Gateway

Tüm provider'ları tek bir normalize arayüz altında birleştirir:

| Özellik | Açıklama |
|---|---|
| **Streaming Unify** | Tüm providerlardan gelen stream'i tek formata dönüştür |
| **Tool Calling Normalize** | Farklı provider tool calling formatlarını standartlaştır |
| **Retry / Backoff** | Hata durumunda akıllı yeniden deneme |
| **Token Budgeting** | Her çağrı öncesi token sayımı ve limit kontrolü |
| **Rate Limiting** | Provider rate limits'e uygun istek yönetimi |

### 9.2 Smart Router (Maliyet/Kalite Dengesi)

İş tipini sınıflandırıp en uygun modele yönlendirir.

| İş Tipi | Model Tercihi | Örnek Görev |
|---|---|---|
| `reasoning` | Premium tier | Plan oluşturma, mimari karar |
| `codegen` | Codegen tier | Kod yazma, test yazma |
| `review` | Premium/Local | Kod inceleme, güvenlik analizi |
| `cheap` | Ekonomik tier | Basit formatlama, küçük düzenleme |
| `fast` | Düşük latency | Oto-tamamlama, kısa yanıt |
| `long_context` | Geniş pencere | Büyük dosya analizi |
| `tool_use` | Tool-capable | Tool çağrısı gerektiren görevler |

#### Router karar sözleşmesi

1. İş sınıflandırması `task + state + agent-role + tool-needs` sinyalleriyle yapılır.
2. `PLAN_DRAFTED` ve `AWAITING_PLAN_CONFIRMATION` durumlarında varsayılan sınıf `reasoning` olur.
3. `IMPLEMENTING` ve `REFACTOR` durumlarında varsayılan sınıf `codegen` olur.
4. Kritik güvenlik/review adımlarında minimum sınıf `review` altına düşürülemez.

#### Fallback sırası

- Birincil model başarısız olursa aynı sınıf içinde ikinci modele geçilir.
- Aynı sınıf yoksa bir üst kalite sınıfına çıkar (ör. `cheap -> codegen`, `codegen -> reasoning`).
- Maksimum yeniden deneme: `2`.
- Fallback sonucu event stream'e `model.fallback` olarak yazılır.

#### Manuel override

- Kullanıcı `/model` ile manuel model seçerse, o tur için router kararı override edilir.
- Override durumu event stream'e `model.override` olarak kaydedilir.

---
## 10. Güvenlik Mimarisi

### 10.1 Guardian Gate

Her write/exec öncesi çalışan güvenlik tarama katmanı:

| Tarama | Aksiyon |
|---|---|
| **API Key / Secret tespiti** | BLOCK + kullanıcıyı uyar |
| **Riskli pattern tespiti** | WARN veya BLOCK |
| **Path traversal kontrolü** | Repo dışı erişim → BLOCK |
| **Secret redaction** | Loglarda key/password maskeleme |

### 10.2 Policy Engine

Kurallar `.matrix/config.json` ve `MATRIX.md` dosyalarından okunur:

| Kural | Açıklama |
|---|---|
| **Path rules** | Repo dışına write yok (cache klasörleri hariç) |
| **File denylist** | `.env`, `keys`, `*.pem`, SSH dosyaları korumalı |
| **Command denylist** | `rm -rf /`, `sudo`, `curl \| bash` gibi riskli komutlar |
| **Command allowlist** | İzin verilen komut listesi (fast mode için) |
| **Secret patterns** | Regex ile API key/token/password tespiti |

### 10.3 Kademeli Sandbox (İleriye Yönelik)

| Tier | Teknoloji | Başlatma | Kullanım |
|---|---|---|---|
| **Tier 1** | Node `vm` / `isolated-vm` | <5ms | Mantık yürütme, metin, AST |
| **Tier 2** | Bubblewrap / Docker | 10-50ms | Test, lint, script |
| **Tier 3** | Firecracker microVM | ~150ms | Bilinmeyen binary, `npm install` |

> **v0.1'de:** Tier 1 + Guardian Gate + Policy Engine yeterli.
> **v0.2+:** Tier 2 (Docker/WSL2 soyutlaması) eklenir.

### 10.4 Genel Güvenlik İlkeleri

- Key'ler asla server'a gitmez
- Telemetry varsayılan kapalı; açılırsa açıkça belirtilir
- Audit log: tool çağrıları, diff'ler, onaylar kaydedilir
- Least privilege: `balanced` mode default
- Supply chain: lockfile + imzalı release
- İzin Kartı (Permission Card): Riskli işlem öncesi TUI'da açık onay

---

## 11. MCP Runtime (Tool Ekosistemi)

MCP "komut" değil, yönetilen bir runtime'dır:

| Özellik | Açıklama |
|---|---|
| **Server registry** | MCP sunucuları ekleme/kaldırma/etkinleştirme/devre dışı bırakma |
| **Healthcheck** | Sunucu sağlık kontrolü + version metadata |
| **Tool discovery** | Dinamik araç keşfi ve ajan yetenek setine ekleme |
| **Per-tool permission** | Araç bazlı izin yönetimi |
| **Audit log** | MCP tool çağrıları kaydedilir |
| **Redaction** | Hassas veriler loglardan maskelenir |
| **Config** | `.matrix/mcp.json` ile yapılandırma |

**MCP kullanım örnekleri:**
- Postgres MCP → Veritabanı şema okuma, SQL çalıştırma
- GitHub MCP → PR oluşturma, issue yönetimi
- Slack MCP → Takım iletişimi
- Linear MCP → Görev yönetimi

**Gizlilik:** Veritabanı kimlik bilgileri gibi hassas veriler LLM sağlayıcısına gönderilmez; işlem yerel MCP sunucusu içinde gerçekleşir, sadece filtrelenmiş sonuç modele iletilir.

---

## 12. Konfigürasyon Standardı

### 12.1 Proje Dosyaları

| Dosya | Açıklama |
|---|---|
| `MATRIX.md` | Proje kuralları, stil rehberi, mimari prensipler |
| `AGENTS.md` | Ajan davranışları, tool politikaları, özel talimatlar |
| `.matrix/config.json` | Model, approval, tools, MCP, workflow ayarları |
| `.matrix/commands/*.md` | Custom komut şablonları |
| `.matrix/mcp.json` | MCP sunucu yapılandırması |
| `.matrix/keys.enc` | Şifreli provider key'ler (keychain yoksa) |
| `.matrix/runs/` | Run logları (event stream, redacted) |

### 12.2 `.matrix/config.json` Şema Örneği (v1.2)

```json
{
  "schemaVersion": "1.2.0",
  "activeModel": "gpt-5.3-codex",
  "approvalMode": "balanced",
  "providers": {
    "openai": {
      "baseURL": "https://api.openai.com/v1",
      "envVar": "OPENAI_API_KEY"
    },
    "glm": {
      "baseURL": "https://api.glm.ai/v1",
      "envVar": "GLM_API_KEY"
    }
  },
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@mcp/postgres-server"],
      "env": { "DATABASE_URL": "..." }
    }
  },
  "workflow": {
    "planConfirmationRequired": true,
    "maxReflexionRetries": 3,
    "autoLintOnWrite": true,
    "intent": {
      "approveThreshold": 0.85,
      "confirmThreshold": 0.60,
      "conflictPolicy": "deny_over_approve"
    }
  },
  "quota": {
    "softWarnRatio": 0.90,
    "hardLimitBehavior": "block"
  },
  "smartRouter": {
    "enabled": true,
    "maxFallbackRetries": 2,
    "tiers": {
      "reasoning": "gpt-5.3-codex",
      "codegen": "gpt-5.3-codex",
      "cheap": "minimax-2.5"
    }
  },
  "context": {
    "maxTokenBudget": 128000,
    "softLimitRatio": 0.70,
    "hardLimitRatio": 0.90,
    "enableTreeSitter": true,
    "enableSemanticPruning": true,
    "cacheEnabled": true
  },
  "eventing": {
    "schema": "v1",
    "redactionDefault": "partial",
    "requireCorrelationId": true
  },
  "telemetry": {
    "mode": "off",
    "localRunRetentionDays": 30,
    "analyticsRetentionDays": 90
  },
  "release": {
    "channel": "beta",
    "autoUpdate": false,
    "allowRollback": true
  },
  "security": {
    "secretPatterns": ["AKIA[0-9A-Z]{16}", "sk-[a-zA-Z0-9]{48}"],
    "fileDenylist": [".env", "*.pem", "id_rsa"],
    "commandDenylist": ["rm -rf /", "sudo rm"]
  },
  "compat": {
    "claudeCommandParity": "best_effort",
    "allowPlanApproveCommand": true
  }
}
```

#### Şema sürümleme ve geriye uyumluluk

- `schemaVersion` zorunludur.
- Patch sürümler (`1.2.x`) geriye uyumludur.
- Minor sürüm yükseltmelerinde (`1.x -> 1.y`) otomatik migration çalışır.
- Migration başarısız olursa config değiştirilmez ve kullanıcıya recovery önerisi sunulur.

---
## 13. Teknik Mimari

### 13.1 Teknoloji Seçimleri

| Teknoloji | Kullanım |
|---|---|
| **Node.js + TypeScript** | Tamamen TS (tüm paketler) |
| **React Ink** | Terminal UI (bileşen tabanlı, Yoga düzen) |
| **Zod** | Schema validation |
| **execa** | Command execution |
| **simple-git** | Git işlemleri |
| **keytar** | OS keychain erişimi |
| **libsodium** | Encrypted key fallback |
| **micromatch** | File glob kuralları (policy) |
| **tree-sitter** | AST parsing & indeksleme |
| **better-sqlite3** | Yerel durum kalıcılığı |
| **Zustand** | TUI state management |
| **MCP SDK** | MCP client entegrasyonu |

### 13.2 Monorepo Paket Yapısı

```
matrix/
├── packages/
│   ├── cli/              → Shell komutları + entry point
│   ├── tui/              → Ink bileşenleri + panel layout
│   ├── core/             → Orchestrator + State Machine + Event System
│   ├── tools/            → fs/git/exec/patch/search/test/lint
│   ├── models/           → Provider adapters (OpenAI, GLM, MiniMax, Kimi)
│   ├── auth/             → Login + Key Vault + Entitlements
│   ├── context-engine/   → AST index + CodeRLM + Semantic Pruning + Cache
│   ├── mcp/              → MCP runtime + server registry
│   ├── prompts/          → Agent system prompt kütüphanesi
│   └── security/         → Guardian Gate + Policy Engine + Sandbox
├── MATRIX.md
├── AGENTS.md
├── package.json
└── tsconfig.json
```

### 13.3 Paket Sorumlulukları

| Paket | Sorumluluk |
|---|---|
| `cli` | `matrix init`, `matrix run`, `matrix auth`, `matrix doctor` komutları |
| `tui` | React Ink panelleri, diff viewer, event stream UI, input bar, Permission Card |
| `core` | Durum makinesi, orchestrator, event emitter, run log, checkpoint |
| `tools` | Dosya okuma/yazma, git, exec, patch, search, test runner, linter |
| `models` | Provider adapter'ları, streaming unify, tool calling normalize, retry, token budget |
| `auth` | Matrix login, provider key vault (keytar + libsodium), entitlement check |
| `context-engine` | Tree-sitter AST, hiyerarşik keşif, semantic pruning, cache, context budget |
| `mcp` | MCP server registry, tool discovery, permission, healthcheck |
| `prompts` | Agent system prompt'ları (Plan/Builder/QA/Review/Refactor) |
| `security` | Guardian Gate (secret scan), Policy Engine (allow/deny), sandbox abstraction |

### 13.4 İstemci-Sunucu Ayrımı

Performans ve UX optimizasyonu için:

- **Core Engine (Daemon):** Arka planda çalışır — orchestrator, context engine, model gateway, event system
- **TUI (Construct):** Kullanıcı arayüzü — React Ink, input, streaming render

İletişim: Yerel IPC veya event emitter.

---

## 14. Yol Haritası

### v0.1 — MVP (Temel Çalışan Ürün)

| Özellik | Kapsam |
|---|---|
| **TUI** | Ink TUI + token streaming + event stream UI |
| **Agents** | Plan Agent + Builder Agent (profesyonel prompt'lar) |
| **Tool Runtime** | read/write/patch/exec + approval gate (strict/balanced/fast) |
| **Guardian Gate** | Secret scan + riskli pattern block/warn |
| **Policy Engine** | Path/command allow-deny kuralları |
| **Context Engine Lite** | Hiyerarşik keşif (CodeRLM) + lexical arama (rg) + chunk summary + cache |
| **Semantic Pruning** | AST tabanlı bağlam budama (Tree-sitter) |
| **Model Gateway** | 1-2 provider adapter + streaming unify + tool calling normalize |
| **Smart Router** | Basit iş tipi → model eşlemesi |
| **MCP Runtime** | Server registry + tool discovery + per-tool permission |
| **Auth** | Matrix login + local key vault (keytar + libsodium fallback) |
| **State Persistence** | SQLite ile oturum/görev kalıcılığı |
| **Session** | `/new`, `/resume`, `/clear` |
| **Claude Compat** | Temel `/` komutları |
| **Diff UX** | Diff preview + hunk-level approve/reject |
| **Reflexion** | Builder → QA → hata analizi → düzeltme döngüsü (temel) |

### v0.2 — Genişletilmiş

| Özellik | Kapsam |
|---|---|
| **Agents** | QA + Review + Refactor agent'ları (tam profesyonel) |
| **Diff Viewer** | Yan yana (side-by-side) diff + rollback |
| **MCP** | Tam entegrasyon + çoklu sunucu desteği |
| **Multi-provider** | GLM, MiniMax, Kimi tam destek |
| **Context Engine** | Embeddings + dependency/call graph (hibrit arama) |
| **Generative UI** | A2UI protokolü → tablo, grafik, checklist |
| **Checkpoint / Undo** | Time travel — önceki duruma dönüş |
| **Collaborative Mode** | Kullanıcı dosya değişiklik tespiti + plan adaptasyonu |
| **Session** | `/fork`, `/export`, `/import` |
| **Sandbox Tier 2** | Docker/WSL2 soyutlamalı hafif sandbox |

### v1.0 — Tam Platform

| Özellik | Kapsam |
|---|---|
| **CI / Headless Mod** | `matrix exec` ile pipeline'da çalıştırma |
| **PR Automation** | Otomatik PR oluşturma + açıklama |
| **Quality Gates** | Coverage, performans, güvenlik eşikleri |
| **Deterministic Replay** | Tool-result replay + plan compare (A/B) |
| **Team Policies** | Takım bazlı kural yönetimi |
| **Enterprise Audit Trail** | Kurumsal audit log + uyumluluk |
| **Skill Crystallization** | Ajan çözümleri beceri olarak kaydeder |
| **Local Fine-tuning** | LoRA ile kullanıcı kodlama stiline uyum (opsiyonel) |
| **Plugin Marketplace** | Opsiyonel eklenti mağazası |

---

## 15. Kabul Kriterleri (v0.1, Ölçülebilir)

1. ✅ **Plan Lock Güvencesi:** `AWAITING_PLAN_CONFIRMATION` durumunda write/exec denemeleri %100 bloklanır.
2. ✅ **Doğal Dil Onay Güvenliği:** Onay dataset'inde yanlış-pozitif `approve` oranı `<= %0.5`; düşük güven durumunda explicit teyit zorunludur.
3. ✅ **Diff Kapısı:** Her mutasyon `diff.proposed` event'i üretir; onaysız `diff.applied` olamaz.
4. ✅ **Hunk-Level Doğruluk:** Kısmi onayda sadece seçili hunk'lar uygulanır; reddedilen hunk'lar dosyaya yazılmaz.
5. ✅ **Guardian Gate Etkinliği:** Secret tespiti sentetik test setinde recall `>= %99`; block edilen diff loglarda redacted görünür.
6. ✅ **Policy Determinizmi:** Aynı input için policy kararı deterministiktir; `block > needs_approval > warn > allow` sırası korunur.
7. ✅ **Context Engine Başarımı:** 10K+ dosya repoda context hit rate `>= %85`; hard limit aşımı olmadan fallback ile devam edilir.
8. ✅ **Context Performansı:** Warm p95 context assemble `<= 2.0s`; cold p95 `<= 5.0s`.
9. ✅ **Event Şema Uyumu:** Event'lerin `%100`'ü Envelope v1 zorunlu alanlarını taşır.
10. ✅ **Run Export Güvenliği:** Export edilen run loglarında secret redaction oranı `%100`.
11. ✅ **MCP İzin Disiplini:** İzin verilmeyen MCP tool çağrıları engellenir ve `policy.block` event'i üretilir.
12. ✅ **Reflexion Döngüsü:** Test başarısızlığında en fazla `3` retry yapılır; başarısızlıkta kullanıcıya kontrollü devir yapılır.
13. ✅ **Model Gateway:** En az 1 provider ile streaming + tool calling uçtan uca çalışır.
14. ✅ **Smart Router:** İş tipine göre model seçimi + fallback mekanizması entegrasyon testlerinde geçer.
15. ✅ **Cross-platform:** Windows/macOS/Linux üzerinde `init + plan + build + test` akışı CI matrix'te yeşil olur.

---
## 16. Başarı Metrikleri (KPIs)

| KPI | Tanım | İlk 90 Gün Hedefi | 6. Ay Hedefi |
|---|---|---|---|
| **PRD → Working Feature Süresi** | Onaylı plandan çalışan özelliğe medyan süre | `<= 2 saat` | `<= 75 dk` |
| **Onaylı Diff Başarı Oranı** | Uygulanan diff'in testleri ilk turda geçme oranı | `>= %75` | `>= %85` |
| **Test İlk Geçiş Oranı** | QA'da ilk denemede geçen test oranı | `>= %70` | `>= %82` |
| **Reflexion Çözüm Oranı** | Retry döngüsü ile çözülen hata oranı | `>= %50` | `>= %65` |
| **Kullanıcı Müdahale Sayısı** | Görev başına manuel düzeltme sayısı | `<= 3.0` | `<= 1.8` |
| **Token Maliyeti / Görev** | Görev başına toplam prompt+completion token | Baseline'a göre `-%25` | Baseline'a göre `-%40` |
| **Context Hit Rate** | İlk 5 aday içinde doğru dosya yakalama oranı | `>= %85` | `>= %90` |
| **Crash/Bug Rate** | 1.000 run başına kritik hata sayısı | `<= 8` | `<= 3` |
| **Policy False Block Oranı** | Güvenli aksiyonun yanlış block edilmesi | `<= %2.5` | `<= %1.0` |
| **Onay Niyeti Hata Oranı** | Yanlış intent sınıflandırma oranı | `<= %1.5` | `<= %0.8` |

**Ölçüm penceresi:** KPI'lar haftalık ve aylık olarak raporlanır; release gate kararlarında aylık p95 değerleri esas alınır.

---
## 17. Riskler & Mitigations

| Risk | Olasılık | Etki | Erken Sinyal | Owner | Mitigation |
|---|---|---|---|---|---|
| Provider API farklılıkları | Yüksek | Orta | Adapter test kırılımında artış | `models` owner | Adapter normalize + entegrasyon testleri |
| Güvenlik (exec yoluyla zarar) | Orta | Çok Yüksek | Policy warn/block oranında anomali | `security` owner | Approval + allowlist + Guardian Gate + sandbox |
| TUI karmaşıklığı | Orta | Orta | Görev terk oranında yükseliş | `tui` owner | MVP'de sade panel + kullanılabilirlik testleri |
| Prompt drift (ajan davranış bozulması) | Orta | Yüksek | Golden output sapması | `prompts` owner | Prompt versioning + regression suite |
| Context stuffing (bağlam taşması) | Yüksek | Yüksek | Hard-limit fallback oranında artış | `context-engine` owner | CodeRLM + pruning + token budget |
| Tree-sitter platform uyumluluk | Düşük | Orta | OS-specific parse hataları | `context-engine` owner | Native binary + WASM fallback |
| Büyük repoda indeksleme yavaşlığı | Orta | Orta | Cold start latency p95 yükselişi | `core` owner | İnkremental indeks + file watching + cache |
| Kullanıcı güven kaybı (yanlış edit) | Orta | Yüksek | Reject/rollback oranı artışı | `core` owner | Zorunlu diff preview + checkpoint + undo |
| Doğal dil onay yanlış pozitifleri | Orta | Yüksek | Yanlış `approve` incident sayısı | `core` owner | Confidence eşiği + explicit teyit + fallback komut |
| MCP üzerinden veri sızıntısı | Düşük | Çok Yüksek | Redaction denetiminde sızıntı bulgusu | `mcp` owner | Tool-scoped permission + output filtering + audit |

---
## 18. Non-Goals (v0.1 için Kapsam Dışı)

- ❌ Full debugger entegrasyonu (breakpoint, step-by-step)
- ❌ Tam gerçek zamanlı multi-user edit/merge
- ❌ Plugin marketplace / store
- ❌ Her dil için derin LSP refactoring (v0.2+)
- ❌ Tam Firecracker microVM sandbox (v1.0)
- ❌ Local fine-tuning / LoRA (v1.0)
- ❌ CI/headless mod (v1.0)
- ❌ A2UI / Generative UI (v0.2)
- ❌ Grafik/görsel IDE entegrasyonu

---

## 19. Rekabet Avantajı (Neden "Matrix"?)

1. **Claude uyumlu komut UX'i** + daha geniş model dünyası desteği
2. **Plan-first disiplin** + doğal dil onay (komutsuz)
3. **Matrix TUI:** Event-stream + hunk-level diff onay + hızlı kısayollar
4. **Context Engine:** CodeRLM hiyerarşik keşif + Tree-sitter semantic pruning
5. **Reflexion döngüsü:** Kendi kendine iyileştirme (Kodla → Test → Analiz → Düzelt)
6. **Auth/Plan modeli:** Kullanıcı plan satın alır → entitlement → local key vault
7. **Agent Team:** Plan/Build/QA/Review/Refactor profesyonel prompt setleri
8. **Smart Router:** İş tipine göre otomatik model seçimi → maliyet/kalite dengesi
9. **MCP Ekosistemi:** Tak-çalıştır tool genişletilebilirliği
10. **Güvenlik-first:** Guardian Gate + Policy Engine + sandbox + audit log

---

## 20. Sonuç

Matrix, üç dünyanın en iyisini birleştiren "agentic CLI platformu"dur:

- **Claude Code'un** komut ergonomisi ve konuşma akışkanlığı
- **Codex'in** event-driven yürütme şeffaflığı
- **OpenCode/OpenHands'in** otonom görev tamamlama kapasitesi

Bu üç paradigma, **Context Engine + Policy/Guardian + Smart Router + Reflexion Loop + MCP Runtime** ile güçlendirilerek, büyük projelerde gerçekten işe yarayan bir agentic CLI standardına dönüştürülür.

**Hedef:** Geliştiricinin terminalde **güvenli**, **hızlı**, **şeffaf**, **planlı** ve **yüksek kaliteli** şekilde iş bitirmesini sağlayan, piyasadaki en güçlü CLI deneyimi.

---

## 21. Sözleşmeler (Contracts)

### 21.1 Komut Sonuç Sözleşmesi

Her kullanıcı komutu aşağıdaki result tiplerinden biriyle sonlanır:

| Result | Anlam |
|---|---|
| `success` | İşlem tamamlandı |
| `blocked` | Policy/Güvenlik nedeniyle durduruldu |
| `needs_input` | Kullanıcı girdisi/onayı gerekiyor |
| `error` | Beklenmeyen hata oluştu |

### 21.2 Plan Onay Sözleşmesi

- `approve` intent'i olmadan `IMPLEMENTING` durumuna geçilemez.
- `revise` ve `deny` intent'leri write/exec başlatamaz.
- Belirsiz intent'te sistem `needs_input` döndürür.

### 21.3 Diff Sözleşmesi

- Her dosya mutasyonu için `diff.proposed` zorunludur.
- Uygulanan her diff için `diff.applied` ve checksum kaydı zorunludur.
- Rollback yapılan difflerde `diff.rolled_back` event'i zorunludur.

### 21.4 Tool Policy Sözleşmesi

- Tool çağrıları önce Guardian Gate, sonra Policy Engine'den geçer.
- `block` kararı geri alınamaz; yeni kullanıcı kararı gerekir.
- `needs_approval` kararı yalnız kullanıcı onayıyla `allow`a çevrilebilir.

### 21.5 Provider Adapter Sözleşmesi

Her provider adapter'ı şu arayüzleri normalize eder:
- `stream(messages, tools, config)`
- `tool_call(toolSchema, args)`
- `token_count(messages)`
- `classify_retry(error)`

### 21.6 `matrix doctor` Sağlık Kontratı

- `matrix doctor` insan-okunur çıktı üretir.
- `matrix doctor --json` aşağıdaki zorunlu alanlarla makine-okunur çıktı üretir:

```json
{
  "status": "pass|warn|fail",
  "generatedAt": "ISO-8601",
  "summary": { "pass": 0, "warn": 0, "fail": 0 },
  "checks": [
    {
      "id": "platform|permissions|keychain|network|mcp|sandbox",
      "status": "pass|warn|fail",
      "severity": "low|medium|high",
      "message": "...",
      "remediation": "..."
    }
  ]
}
```

- Exit code kuralı: `0 = pass/warn`, `2 = fail`.

### 21.7 `matrix auth plans` ve Quota Kontratı

- `matrix auth plans` yanıtı zorunlu olarak şu alanları içerir:
  - `planId`, `tier`, `periodStart`, `periodEnd`
  - `remaining`, `softLimit`, `hardLimit`, `resetAt`
  - `hardLimitBehavior` (`block|degrade|queue`)
  - `recommendedAction`
- Quota `hardLimit` aşıldığında davranış deterministik olmalıdır:
  - `block` -> `needs_input` sonucu + kullanıcıya sonraki adım önerisi
  - `degrade` -> düşük maliyetli profile otomatik düşüş
  - `queue` -> görev kuyruğa alınır, ETA gösterilir

### 21.8 Telemetry ve Privacy Kontratı

- Varsayılan telemetry modu: `off`.
- Desteklenen modlar: `off`, `minimal`, `diagnostic`.
- Ayrım zorunludur:
  - `run log` (yerel, detaylı)
  - `product analytics` (anonim, sınırlı alan seti)
- `minimal` modda prompt/kod içeriği analitiğe gönderilmez.
- Secret redaction tüm modlarda zorunludur.
- Kullanıcı kontrolü:
  - `/telemetry`
  - `matrix telemetry status|enable|minimal|disable`

### 21.9 Release Channel ve Update Kontratı

- Desteklenen kanallar: `alpha`, `beta`, `stable`.
- `v0.1 Public Beta` için varsayılan kanal `beta` olmalıdır.
- `matrix update` kanala uygun sürümü getirir.
- `matrix update --rollback` son güvenli sürüme dönüş yapar.
- Kanal değişimi ve rollback olayları audit/event stream'e yazılır.

---

## 22. Test Matrisi ve Release Exit Criteria

### 22.1 Test Matrisi

| Test Katmanı | Kapsam | Çıkış Kriteri |
|---|---|---|
| Unit | Router, intent, policy, redaction, parser | Kritik modüllerde `>= %85` line coverage |
| Integration | State machine + tool pipeline + model gateway | P0/P1 entegrasyon hatası `0` |
| E2E | PRD→Plan→Build→QA→Review akışı | Temel senaryoların `%100` geçişi |
| Security | Secret scan, denylist, path traversal, MCP izinleri | Kritik güvenlik açığı `0` |
| Performance | Context latency, event throughput, cold start | Tanımlı p95 hedefleri sağlanır |
| Compatibility | Claude-style komut davranışları | Compat testlerinin `%95+` geçişi |
| Recovery | Checkpoint restore, crash recovery | Veri kaybı olmadan restore |

### 22.2 Release Exit Criteria

Bir sürümün çıkabilmesi için:
1. P0 bug sayısı `0` olmalı.
2. P1 bug sayısı en fazla `2` olmalı ve workaround dokümante edilmeli.
3. Kabul kriterlerinin tamamı otomasyonla doğrulanmalı.
4. Güvenlik taramasında kritik ve yüksek açık bulunmamalı.
5. Cross-platform CI matrix yeşil olmalı.
6. Redacted run export denetimi geçmeli.
7. Temiz makinede onboarding E2E başarı oranı `>= %80` olmalı.
8. Quota exhaustion senaryoları (`block/degrade/queue`) sözleşmeye uygun geçmeli.
9. `telemetry=off` modunda analitik veri sızıntısı `0` olmalı.
10. SEV-2 incident tatbikatında kullanıcıya ilk bilgilendirme `<= 4 saat` içinde tamamlanmalı.
11. Windows/macOS/Linux üzerinde update + rollback smoke testleri geçmeli.

---

## 23. Operasyon, Incident ve Rollback Protokolü

### 23.1 Incident Seviyeleri

| Seviye | Tanım | Hedef Müdahale |
|---|---|---|
| `SEV-1` | Güvenlik ihlali veya veri sızıntısı riski | `<= 15 dk` |
| `SEV-2` | Kritik işlevin çalışmaması | `<= 1 saat` |
| `SEV-3` | Kısmi fonksiyon kaybı / geçici bozulma | `<= 1 iş günü` |

### 23.2 Rollback Kuralları

- `diff.applied` sonrası test gate kırılırsa otomatik rollback önerilir.
- Kullanıcı manuel rollback başlatırsa son tutarlı checkpoint'e dönülür.
- Rollback sonrası sistem state'i `REVIEW` veya `AWAITING_PLAN_CONFIRMATION` durumuna alınır (bağlama göre).

### 23.3 Audit ve Postmortem

- Tüm SEV-1/SEV-2 olaylarında 48 saat içinde postmortem zorunludur.
- Postmortem çıktıları Decision Log'a eklenir.

### 23.4 Support ve Kullanıcı İletişim Protokolü (Public Beta)

- Destek kanalları: issue tracker + topluluk kanalı + e-posta.
- Public beta ilk yanıt hedefleri:
  - `SEV-1 <= 30 dk`
  - `SEV-2 <= 4 saat`
  - `SEV-3 <= 1 iş günü`
- Her incident için kullanıcıya açık status güncellemesi yayınlanır (`matrix status --service` ve status sayfası).

### 23.5 Rollout ve Ring Stratejisi

- Yayın halkaları: `internal -> canary -> public-beta`.
- Canary geçişi için zorunlu koşullar:
  - P0 = 0
  - Crash/Bug Rate hedef içinde
  - Security gate temiz
- Public-beta promoteda son 7 gün içinde rollback gerektiren kritik vaka olmamalı.

---

## 24. Decision Log (v1.2)

| ID | Karar | Gerekçe | Etki |
|---|---|---|---|
| D-001 | Doğal dil onay korunur, confidence eşikleri zorunlu olur | UX + güvenlik dengesi | Yanlış pozitif riski düşer |
| D-002 | Event Envelope v1 zorunlu alanları tanımlandı | Replay/audit deterministik olsun | Gözlemlenebilirlik artar |
| D-003 | Policy karar önceliği sabitlendi | Deterministik güvenlik zinciri | Çakışmalı kararlar netleşir |
| D-004 | Formatter değişikliği ayrı diff onayına bağlandı | Diff-gate ilkesi korunur | Sessiz mutasyon engellenir |
| D-005 | Config'e `schemaVersion` zorunlu alanı eklendi | Migration ve uyumluluk yönetimi | Operasyonel risk azalır |
| D-006 | Ölçülebilir kabul kriterleri tanımlandı | Release kalitesi sayısallaşsın | Teslimat kalitesi artar |
| D-007 | Release exit criteria sabitlendi | "hazır" tanımı netleşsin | Yayın güveni artar |
| D-008 | Incident/rollback protokolü eklendi | Üretim güvenliği | Kurtarma süresi kısalır |
| D-009 | Telemetry/privacy kontratı eklendi | Ürün analitiği ve gizlilik ayrışsın | Veri yönetişimi netleşir |
| D-010 | `matrix doctor --json` zorunlu sağlık kontratı eklendi | Otomasyon ve destek hızlansın | Tanılama standardize olur |
| D-011 | Quota exhaustion davranışı sözleşmeye bağlandı | Limit anında UX belirsizliği kalksın | Ticarileşme riski azalır |
| D-012 | Release channel + update/rollback kontratı eklendi | Beta operasyonu güvenli olsun | Yayın/kurtarma çevikliği artar |
| D-013 | Public beta support SLO'ları tanımlandı | Kullanıcı güveni ve iletişim netliği | Destek operasyonu ölçülebilir olur |
| D-014 | Product-ready beta gate'leri release kriterine eklendi | Sadece teknik değil ürünsel hazır olma | Go-live kalitesi artar |

---

## 25. Productization ve Public Beta Operasyonu

### 25.1 Onboarding Paketi

- Zorunlu dokümanlar:
  - 10 dakikalık quickstart
  - provider key ekleme rehberi
  - `matrix doctor` arıza giderme akışı
  - known limitations (v0.1)
- İlk değer (TTFV) hedefi: yeni kullanıcı için `<= 15 dk`.

### 25.2 Dağıtım ve Güncelleme

- Dağıtım artefaktları: Windows/macOS/Linux için imzalı binary + checksum.
- `beta` kanalı varsayılan; `stable` kanalı yalnız GA sonrası önerilir.
- Her sürüm için rollback notu zorunludur.

### 25.3 Telemetry Yönetişimi

- `off` dışındaki modlarda dahi kod içeriği analitiğe gönderilmez.
- Analytics tarafında yalnız allowlist alanlar kabul edilir.
- Retention varsayılanları:
  - Yerel run log: 30 gün (konfigüre edilebilir)
  - Analytics: 90 gün (yalnız opt-in)

### 25.4 Public Beta Exit -> GA Kriterleri

- Son 4 haftada:
  - P0 incident = 0
  - Crash/Bug Rate KPI hedefi içinde
  - Security kritik bulgu = 0
  - Onboarding başarı oranı `>= %85`
  - Support hedefleri ardışık 4 hafta karşılanmış
- Bu koşullar sağlanmadan `stable` kanal varsayılan yapılamaz.

---

> 🔒 **Bu PRD kilitlenmiştir (v1.2).** Tüm geliştirme bu dokümana referansla yapılacaktır.
