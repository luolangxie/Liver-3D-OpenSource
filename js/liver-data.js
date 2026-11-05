/* =========================================================================
 * liver-data.js — anatomical content: structures, vessel trees, key points
 * All coordinates are in the same right-handed cm frame as liver-geometry:
 *   +X = patient right, +Y = superior, +Z = anterior.
 * Text references (REF[...]) are listed in full in REFERENCES.md and in the
 * "文献" panel of the app.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiverData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Couinaud segments — colours follow the usual atlas convention
   * ------------------------------------------------------------------ */
  var SEGMENTS = [
    { id: 1, zh: 'Ⅰ段（尾状叶）', short: 'Ⅰ', latin: 'segmentum I (lobus caudatus)', en: 'caudate lobe',
      color: '#b07aa1',
      bullets: [
        '尾状叶血供相对独立：接受门静脉左、右支及肝左、右动脉发出的直接小支，可视为具有自身门管支的肝叶。',
        '其静脉回流通过 2～3 支细小的尾状叶静脉直接注入下腔静脉，不经过三大肝静脉。',
        '位于肝门后方、下腔静脉左前方，介于静脉韧带裂（左侧）与下腔静脉沟（右侧）之间。'
      ],
      clinical: ['因血供与回流均相对独立，可行单独尾状叶切除（isolated caudate lobectomy）；布加综合征时尾状叶常代偿性肥大。'],
      refs: ['ta2', 'grays43', 'strasberg2005', 'hajibandeh2023'] },
    { id: 2, zh: 'Ⅱ段（左外叶上段）', short: 'Ⅱ', latin: 'segmentum II', en: 'left lateral superior segment',
      color: '#4e79a7',
      bullets: ['属左外叶（left lateral section）的上位段，位于左肝静脉平面以左、门静脉横裂平面以上。',
                '位于左叶后上份，构成左叶膈面的大部。'],
      clinical: ['左外叶切除（Ⅱ+Ⅲ段）是活体肝移植供肝获取的标准术式。'],
      refs: ['couinaud1957', 'strasberg2005', 'brisbane2013'] },
    { id: 3, zh: 'Ⅲ段（左外叶下段）', short: 'Ⅲ', latin: 'segmentum III', en: 'left lateral inferior segment',
      color: '#76b7b2',
      bullets: ['左外叶的下位段，位于门静脉左支脐部平面以下、左肝静脉平面以左。',
                '占据左叶前下份，是左叶最薄的部分，其下缘即肝左叶下缘。'],
      clinical: ['左外叶体积是活体肝移植供受体匹配的关键参数之一。'],
      refs: ['couinaud1957', 'strasberg2005'] },
    { id: 4, zh: 'Ⅳ段（左内叶／方叶）', short: 'Ⅳ', latin: 'segmentum IV', en: 'left medial section (quadrate)',
      color: '#59a14f',
      bullets: ['位于肝中静脉平面与肝左静脉平面之间，表面即方叶（lobus quadratus）。',
                '以肝门横裂平面分为Ⅳa（上）与Ⅳb（下）；胆囊窝位于Ⅳb与Ⅴ段之间。',
                '是唯一同时毗邻胆囊窝、肝门与肝圆韧带裂的肝段。'],
      clinical: ['Ⅳb段与胆囊床紧贴，胆囊癌侵犯胆囊床时需联合Ⅳb/Ⅴ段切除。'],
      refs: ['couinaud1957', 'strasberg2005', 'bismuth1982'] },
    { id: 5, zh: 'Ⅴ段（右前叶下段）', short: 'Ⅴ', latin: 'segmentum V', en: 'right anterior inferior segment',
      color: '#edc948',
      bullets: ['右前叶（right anterior section）的下位段，位于肝中静脉平面以右、门静脉横裂平面以下。',
                '其脏面与胆囊、十二指肠及结肠右曲相邻。'],
      clinical: ['是胆囊癌直接浸润最常见的肝段。'],
      refs: ['couinaud1957', 'strasberg2005'] },
    { id: 6, zh: 'Ⅵ段（右后叶下段）', short: 'Ⅵ', latin: 'segmentum VI', en: 'right posterior inferior segment',
      color: '#f28e2b',
      bullets: ['右后叶（right posterior section）的下位段，位于肝右静脉平面以后、门静脉横裂平面以下。',
                '其脏面有右肾压迹与结肠压迹。'],
      clinical: ['该段常有粗大的右下肝静脉（副肝静脉）直接汇入下腔静脉，右半肝切除时须注意。'],
      refs: ['couinaud1957', 'strasberg2005'] },
    { id: 7, zh: 'Ⅶ段（右后叶上段）', short: 'Ⅶ', latin: 'segmentum VII', en: 'right posterior superior segment',
      color: '#e15759',
      bullets: ['右后叶的上位段，紧贴膈肌，位置最高、暴露最困难。',
                '其后方为裸区与右三角韧带。'],
      clinical: ['经胸腔或经膈途径可缩短Ⅶ段病灶的显露距离。'],
      refs: ['couinaud1957', 'strasberg2005'] },
    { id: 8, zh: 'Ⅷ段（右前叶上段）', short: 'Ⅷ', latin: 'segmentum VIII', en: 'right anterior superior segment',
      color: '#9c755f',
      bullets: ['右前叶的上位段，位于肝中静脉与肝右静脉平面之间、门静脉横裂平面以上。',
                '肝中静脉与肝右静脉在其深面走行，是段间界面的标志。'],
      clinical: ['Ⅷ段位于肝顶，是右肝静脉汇合部所在，切除时须保护肝中静脉。'],
      refs: ['couinaud1957', 'strasberg2005'] }
  ];

  /* ------------------------------------------------------------------ *
   * Vessel / duct / ligament trees
   * ------------------------------------------------------------------ */
  var STRUCTURES = [

    /* ---------------- portal venous system ---------------- */
    { id: 'pv-main', group: 'portal', zh: '门静脉主干', latin: 'vena portae hepatis', en: 'main portal vein',
      color: '#5b7fd4', radius: [0.72, 0.72, 0.70, 0.68],
      points: [[1.50, -9.60, -1.10], [1.45, -7.40, -1.50], [1.38, -5.20, -1.85], [1.32, -3.55, -2.10], [1.55, -2.85, -2.30]],
      label: [1.40, -6.20, -1.60],
      bullets: [
        '由肠系膜上静脉与脾静脉在胰颈后方汇合而成，成人长约 6～8 cm，正常管径约 10～13 mm。',
        '在肝门处分为左、右两支，分叉点位于肝门横沟内、尾状叶前方。',
        '运送全部胃肠道、脾、胰的静脉血，约占入肝血流的 70%～80%。'
      ],
      clinical: ['门静脉高压时管径增宽、血流减慢；门静脉血栓或癌栓是肝移植的禁忌因素之一。'],
      refs: ['grays43', 'moore8', 'tutkuviene2024', 'kostov2023'] },

    { id: 'pv-r', group: 'portal', zh: '门静脉右支', latin: 'ramus dexter venae portae', en: 'right portal vein',
      color: '#5b7fd4', radius: [0.62, 0.58, 0.55],
      points: [[1.55, -2.85, -2.30], [3.20, -2.80, -2.42], [4.55, -2.70, -2.30]],
      label: [3.20, -2.75, -2.40],
      bullets: ['门静脉右支短而粗，主干长约 1～3 cm，随即分为右前叶支与右后叶支。',
                '右前叶支供应Ⅴ、Ⅷ段，右后叶支供应Ⅵ、Ⅶ段。'],
      clinical: ['右门静脉分支变异常见（如右后叶支直接起自门静脉主干），是右半肝活体供肝 Mustard 分型的依据。'],
      refs: ['tutkuviene2024', 'luo2025', 'bismuth1982'] },

    { id: 'pv-r-ant', group: 'portal', zh: '门静脉右前叶支', latin: 'ramus anterior rami dextri', en: 'right anterior sectoral branch',
      color: '#5b7fd4', radius: [0.48, 0.45, 0.40],
      points: [[4.55, -2.70, -2.30], [5.35, -2.35, -1.40], [5.85, -1.95, -0.60]],
      label: [5.45, -2.20, -1.20],
      bullets: ['供应右前叶（Ⅴ、Ⅷ段），沿右前叶的门管系统向周围分支。',
                '与肝右静脉、肝中静脉的分支相互交错，是右前叶切除的解剖基础。'],
      clinical: ['右前叶门静脉支与右后叶支的共干方式决定右半肝的分段切除方式。'],
      refs: ['couinaud1957', 'strasberg2005'] },

    { id: 'pv-r-ant-8', group: 'portal', zh: '门静脉Ⅷ段支', latin: 'ramus segmenti VIII', en: 'segment VIII portal branch',
      color: '#5b7fd4', radius: [0.34, 0.30],
      points: [[5.85, -1.95, -0.60], [6.35, -0.90, 0.20], [6.60, 1.10, 0.50]],
      label: [6.45, 0.20, 0.35],
      bullets: ['向肝顶部走行，供应Ⅷ段。'],
      clinical: ['该支位置高，是Ⅷ段切除时最先遇到的门管蒂。'],
      refs: ['couinaud1957'] },

    { id: 'pv-r-ant-5', group: 'portal', zh: '门静脉Ⅴ段支', latin: 'ramus segmenti V', en: 'segment V portal branch',
      color: '#5b7fd4', radius: [0.34, 0.28],
      points: [[5.85, -1.95, -0.60], [6.45, -2.75, 0.40], [6.90, -3.05, 1.30]],
      label: [6.70, -2.90, 1.00],
      bullets: ['向下前走行，供应Ⅴ段，邻近胆囊窝。'],
      clinical: ['与胆囊静脉、胆囊动脉毗邻，胆囊切除时易损伤。'],
      refs: ['couinaud1957'] },

    { id: 'pv-r-post', group: 'portal', zh: '门静脉右后叶支', latin: 'ramus posterior rami dextri', en: 'right posterior sectoral branch',
      color: '#5b7fd4', radius: [0.48, 0.44, 0.38],
      points: [[4.55, -2.70, -2.30], [5.30, -2.95, -3.10], [6.10, -3.00, -3.55]],
      label: [5.45, -2.95, -3.25],
      bullets: ['供应右后叶（Ⅵ、Ⅶ段），向后上方走行。',
                '右后叶支常较早从门静脉主干或右支发出，是右后叶切除的解剖要点。'],
      clinical: ['右后叶门静脉支起源变异率较高，术前三维重建有助于避免误扎。'],
      refs: ['luo2025', 'tutkuviene2024'] },

    { id: 'pv-r-post-7', group: 'portal', zh: '门静脉Ⅶ段支', latin: 'ramus segmenti VII', en: 'segment VII portal branch',
      color: '#5b7fd4', radius: [0.32, 0.27],
      points: [[6.10, -3.00, -3.55], [6.50, -1.60, -3.80], [6.75, 0.40, -3.50]],
      label: [6.60, -0.60, -3.70],
      bullets: ['向上后方走行，供应Ⅶ段。'],
      clinical: ['邻近右肝静脉主干，切除时注意保护。'],
      refs: ['couinaud1957'] },

    { id: 'pv-r-post-6', group: 'portal', zh: '门静脉Ⅵ段支', latin: 'ramus segmenti VI', en: 'segment VI portal branch',
      color: '#5b7fd4', radius: [0.32, 0.27],
      points: [[6.10, -3.00, -3.55], [7.05, -3.20, -2.90], [7.60, -3.25, -2.00]],
      label: [7.30, -3.20, -2.40],
      bullets: ['向外下方走行，供应Ⅵ段，位于右肾压迹附近。'],
      clinical: ['该段常有副肝静脉回流，术中需辨认。'],
      refs: ['couinaud1957'] },

    { id: 'pv-l', group: 'portal', zh: '门静脉左支', latin: 'ramus sinister venae portae', en: 'left portal vein',
      color: '#5b7fd4', radius: [0.55, 0.52, 0.48, 0.44],
      points: [[1.55, -2.85, -2.30], [0.40, -2.75, -2.20], [-1.05, -2.60, -1.80], [-2.20, -2.45, -0.70]],
      label: [-0.90, -2.65, -1.85],
      bullets: [
        '左支较长，先横行（横部 pars transversa），再转向前上方形成脐部（pars umbilicalis）。',
        '横部发出尾状叶支与Ⅳ段支；脐部发出Ⅱ、Ⅲ、Ⅳ段支。',
        '脐部与肝圆韧带相连，是左半肝分段的重要标志。'
      ],
      clinical: ['左门静脉横部位于肝门横沟内，是左半肝切除时处理门管蒂的平面。'],
      refs: ['bismuth1982', 'grays43'] },

    { id: 'pv-l-umb', group: 'portal', zh: '门静脉左支脐部', latin: 'pars umbilicalis', en: 'umbilical portion',
      color: '#5b7fd4', radius: [0.42, 0.38],
      points: [[-2.20, -2.45, -0.70], [-2.60, -2.35, 0.30]],
      label: [-2.45, -2.40, -0.10],
      bullets: ['脐部位于肝圆韧带裂内，是左外叶与左内叶的分界点。',
                '肝圆韧带（脐静脉闭锁后的遗迹）即附着于此处。'],
      clinical: ['活体肝移植左外叶获取时，脐部是必须保留或重建的关键结构。'],
      refs: ['bismuth1982', 'grays43'] },

    { id: 'pv-l-2', group: 'portal', zh: '门静脉Ⅱ段支', latin: 'ramus segmenti II', en: 'segment II portal branch',
      color: '#5b7fd4', radius: [0.30, 0.26, 0.22],
      points: [[-2.60, -2.35, 0.30], [-3.30, -1.60, 0.60], [-4.20, 0.30, 0.75]],
      label: [-3.60, -0.70, 0.70],
      bullets: ['自脐部向上后外侧走行，供应Ⅱ段。'],
      clinical: ['左外叶供肝时该支需保持完整。'],
      refs: ['couinaud1957'] },

    { id: 'pv-l-3', group: 'portal', zh: '门静脉Ⅲ段支', latin: 'ramus segmenti III', en: 'segment III portal branch',
      color: '#5b7fd4', radius: [0.30, 0.26, 0.22],
      points: [[-2.60, -2.35, 0.30], [-3.60, -2.90, 0.50], [-4.90, -2.60, 0.70]],
      label: [-4.20, -2.80, 0.60],
      bullets: ['自脐部向左前下方走行，供应Ⅲ段。'],
      clinical: ['与Ⅱ段支共干或分别起源，存在个体差异。'],
      refs: ['couinaud1957'] },

    { id: 'pv-l-4', group: 'portal', zh: '门静脉Ⅳ段支', latin: 'ramus segmenti IV', en: 'segment IV portal branch',
      color: '#5b7fd4', radius: [0.28, 0.24],
      points: [[-2.10, -2.50, -0.60], [-2.35, -0.80, -0.90], [-2.55, 0.60, -1.20]],
      label: [-2.35, -0.40, -0.95],
      bullets: ['自左支横部／脐部发出，向上供应Ⅳ段。'],
      clinical: ['Ⅳ段支常有多支，行Ⅳ段切除时须逐一处理。'],
      refs: ['couinaud1957'] },

    { id: 'pv-caudate', group: 'portal', zh: '门静脉尾状叶支', latin: 'ramus lobi caudati', en: 'caudate portal branches',
      color: '#5b7fd4', radius: [0.22, 0.18],
      points: [[1.55, -2.85, -2.30], [1.45, -2.05, -3.40], [1.15, -1.10, -4.20]],
      label: [1.30, -1.90, -3.60],
      bullets: ['起自门静脉分叉部及左支横部，直接进入尾状叶。'],
      clinical: ['尾状叶血供独立是尾状叶单独切除的解剖基础。'],
      refs: ['grays43', 'ta2'] },

    /* ---------------- hepatic veins ---------------- */
    { id: 'hv-r', group: 'hepatic-vein', zh: '肝右静脉', latin: 'vena hepatica dextra', en: 'right hepatic vein',
      color: '#3f8fd0', radius: [0.38, 0.45, 0.55, 0.68, 0.78],
      points: [[8.40, -1.70, 1.30], [7.15, 0.40, 0.40], [5.60, 2.20, -1.10], [4.10, 3.50, -2.70], [2.95, 4.20, -3.80]],
      label: [5.70, 2.10, -1.00],
      bullets: [
        '引流Ⅴ、Ⅵ、Ⅶ、Ⅷ段（右半肝），走行于右门静脉裂（右段间平面）内。',
        '肝右静脉平面将右半肝分为右前叶与右后叶。',
        '汇入下腔静脉肝后段的右前壁，开口低于肝中静脉。'
      ],
      clinical: ['肝右静脉短粗、壁薄，右半肝切除时需在肝外或肝内细致处理；其属支变异（如右后下静脉）很常见。'],
      refs: ['grays43', 'bismuth1982', 'couinaud1957', 'fang2012'] },

    { id: 'hv-m', group: 'hepatic-vein', zh: '肝中静脉', latin: 'vena hepatica media', en: 'middle hepatic vein',
      color: '#3f8fd0', radius: [0.34, 0.40, 0.48, 0.58, 0.70],
      points: [[0.10, -3.30, 3.00], [0.45, -1.60, 2.20], [0.95, 0.60, 0.80], [1.75, 2.60, -1.20], [2.40, 3.80, -3.20], [2.75, 4.20, -3.95]],
      label: [0.95, 0.50, 0.70],
      bullets: [
        '沿 Cantlie 线（主门静脉裂）走行，将肝分为左、右半肝，是肝切除最重要的段间界面。',
        '引流Ⅳ、Ⅴ、Ⅷ段。',
        '与肝左静脉形成共干后汇入下腔静脉的比例约 60%（3D-CT 200 例为 61%，尸体研究为 60%）。'
      ],
      clinical: ['肝中静脉的取舍是活体右半肝移植争论的焦点：保留可致供肝淤血，切取则须重建Ⅴ/Ⅷ段回流。'],
      refs: ['grays43', 'bismuth1982', 'strasberg2005', 'fang2012'] },

    { id: 'hv-l', group: 'hepatic-vein', zh: '肝左静脉', latin: 'vena hepatica sinistra', en: 'left hepatic vein',
      color: '#3f8fd0', radius: [0.30, 0.36, 0.44, 0.54, 0.66],
      points: [[-6.00, -0.60, 2.20], [-4.30, 0.80, 1.50], [-2.70, 2.10, 0.20], [-1.10, 3.30, -1.60], [0.90, 3.95, -3.10], [2.25, 4.15, -3.90]],
      label: [-2.70, 2.00, 0.20],
      bullets: [
        '走行于左门静脉裂内，将左半肝分为左内叶（Ⅳ）与左外叶（Ⅱ、Ⅲ）。',
        '主要引流Ⅱ、Ⅲ段，并有属支引流Ⅳa段。',
        '常与肝中静脉合成共干（约 60% 的个体）后注入下腔静脉。'
      ],
      clinical: ['左外叶获取时须仔细处理肝左静脉；共干变异影响静脉吻合方式。'],
      refs: ['grays43', 'bismuth1982', 'fang2012', 'tolahunase2025'] },

    { id: 'hv-aiv', group: 'hepatic-vein', zh: '肝右副静脉（右后下静脉）', latin: 'vena hepatica accessoria dextra', en: 'accessory right hepatic vein',
      color: '#3f8fd0', radius: [0.30, 0.34, 0.38],
      points: [[8.70, -3.00, -2.10], [6.90, -2.50, -2.80], [4.80, -1.60, -3.60], [3.35, -0.50, -4.15]],
      label: [6.20, -2.20, -3.05],
      bullets: ['引流Ⅵ段（有时包括Ⅶ段下部）直接入下腔静脉，出现率较高。',
                '管径可为 3～10 mm，是右半肝切除后残肝回流的重要通道。'],
      clinical: ['右半肝切除时若切断粗大的右后下静脉而未重建，可导致Ⅵ段淤血。'],
      refs: ['grays43', 'moore8'] },

    { id: 'hv-caudate', group: 'hepatic-vein', zh: '尾状叶静脉', latin: 'venae lobi caudati', en: 'caudate veins',
      color: '#3f8fd0', radius: [0.20, 0.20],
      points: [[1.15, 1.30, -4.60], [2.30, 1.30, -4.55]],
      label: [1.70, 1.30, -4.60],
      bullets: ['2～3 支短小静脉，直接开口于下腔静脉肝后段。'],
      clinical: ['是尾状叶切除时最后处理的血管，也是布加综合征分流的主要通道。'],
      refs: ['grays43'] },

    /* ---------------- hepatic artery ---------------- */
    { id: 'ha-pha', group: 'artery', zh: '肝固有动脉', latin: 'arteria hepatica propria', en: 'proper hepatic artery',
      color: '#d0453a', radius: [0.30, 0.28, 0.26, 0.24],
      points: [[1.00, -8.20, -3.05], [1.10, -6.20, -2.95], [1.25, -4.55, -3.00], [1.45, -3.30, -2.85]],
      label: [1.15, -5.60, -2.95],
      bullets: [
        '由肝总动脉发出，在肝十二指肠韧带内位于门静脉前方、胆总管左侧。',
        '在肝门处分为肝左、右动脉；胆囊动脉多起自肝右动脉。',
        '提供约 20%～30% 的入肝血流，但供应约一半的肝脏氧需求。'
      ],
      clinical: ['肝动脉起源变异常见（Michels 分类）：不同系列差异较大，右肝动脉起自肠系膜上动脉约 3%～13%、左肝动脉起自胃左动脉约 3%～10%，取决于是否计入副肝动脉；术前 CTA 评估是肝移植与肝切除的常规。'],
      refs: ['michels1966', 'fonseca2017', 'kalra2021', 'grays43', 'moore8', 'kostov2023'] },

    { id: 'ha-r', group: 'artery', zh: '肝右动脉', latin: 'arteria hepatica dextra', en: 'right hepatic artery',
      color: '#d0453a', radius: [0.24, 0.22, 0.18],
      points: [[1.45, -3.30, -2.85], [2.75, -3.15, -2.65], [4.05, -3.00, -2.60], [5.20, -2.80, -2.40]],
      label: [3.60, -3.05, -2.65],
      bullets: ['多起自肝固有动脉，经肝总管后方（约 80% 的个体）进入右半肝。',
                '发出胆囊动脉后分为右前、右后叶动脉。'],
      clinical: ['变异时（如起自肠系膜上动脉）可经胆管后方或前方走行，胆囊切除时易误伤。'],
      refs: ['michels1966', 'fonseca2017', 'grays43'] },

    { id: 'ha-l', group: 'artery', zh: '肝左动脉', latin: 'arteria hepatica sinistra', en: 'left hepatic artery',
      color: '#d0453a', radius: [0.22, 0.20, 0.16],
      points: [[1.45, -3.30, -2.85], [0.50, -3.20, -2.55], [-0.70, -3.05, -1.95], [-1.90, -2.95, -1.20]],
      label: [-0.40, -3.10, -2.10],
      bullets: ['经肝门向左，多沿静脉韧带裂走行，分出Ⅱ、Ⅲ、Ⅳ段动脉。'],
      clinical: ['部分个体肝左动脉起自胃左动脉（Michels Ⅱ型变异），各系列报道为 3%～10%。'],
      refs: ['michels1966', 'fonseca2017'] },

    { id: 'ha-cystic', group: 'artery', zh: '胆囊动脉', latin: 'arteria cystica', en: 'cystic artery',
      color: '#d0453a', radius: [0.16, 0.14],
      points: [[2.95, -3.10, -2.55], [2.20, -3.25, -1.40], [1.15, -3.45, 0.10]],
      label: [2.00, -3.30, -1.20],
      bullets: ['通常起自肝右动脉，走行于胆囊三角（Calot 三角）内，至胆囊颈部分为浅、深两支。'],
      clinical: ['Calot 三角内辨认"前哨淋巴结"与胆囊动脉是腹腔镜胆囊切除的安全关键（"Critical View of Safety"）。'],
      refs: ['grays43', 'moore8'] },

    /* ---------------- biliary tree ---------------- */
    { id: 'bd-rhd', group: 'bile', zh: '肝右管', latin: 'ductus hepaticus dexter', en: 'right hepatic duct',
      color: '#4aa564', radius: [0.22, 0.24],
      points: [[4.60, -3.05, -2.75], [3.30, -3.10, -2.60], [2.10, -3.15, -2.50]],
      label: [3.60, -3.10, -2.65],
      bullets: ['由右前、右后叶肝管汇合而成，短而粗。'],
      clinical: ['右后叶肝管与右前叶肝管的汇合方式变异多，是胆道损伤的危险点。'],
      refs: ['grays43', 'moore8'] },

    { id: 'bd-lhd', group: 'bile', zh: '肝左管', latin: 'ductus hepaticus sinister', en: 'left hepatic duct',
      color: '#4aa564', radius: [0.20, 0.24],
      points: [[-1.60, -3.10, -1.60], [-0.30, -3.15, -1.95], [1.90, -3.15, -2.40]],
      label: [-0.20, -3.15, -1.95],
      bullets: ['较长，横行于肝门横沟内，位于门静脉左支的前上方。'],
      clinical: ['肝左管在肝门处位置恒定、行程较长，是胆肠吻合常选用的胆管。'],
      refs: ['grays43', 'strasberg2005'] },

    { id: 'bd-chd', group: 'bile', zh: '肝总管', latin: 'ductus hepaticus communis', en: 'common hepatic duct',
      color: '#4aa564', radius: [0.26, 0.26, 0.26],
      points: [[1.95, -3.20, -2.40], [1.70, -4.60, -2.10], [1.55, -6.20, -1.95]],
      label: [1.70, -4.60, -2.05],
      bullets: ['由肝左、右管在肝门下方汇合而成，长 2～4 cm，位于肝十二指肠韧带内、门静脉前方偏右。'],
      clinical: ['胆囊管汇入位置变异（低位、内侧汇入）是胆道损伤的重要原因。'],
      refs: ['grays43', 'moore8'] },

    { id: 'bd-cbd', group: 'bile', zh: '胆总管', latin: 'ductus choledochus', en: 'common bile duct',
      color: '#4aa564', radius: [0.28, 0.28, 0.26],
      points: [[1.55, -6.30, -1.95], [1.35, -8.60, -2.20], [1.10, -10.80, -2.60], [0.95, -12.20, -3.00]],
      label: [1.30, -8.60, -2.20],
      bullets: ['长 6～8 cm，正常管径上限约 7～8 mm（不同作者取 7 mm 或 8 mm，随年龄略增），末端与主胰管汇合形成肝胰壶腹。'],
      clinical: ['胆总管结石或肿瘤梗阻时管径增宽；直径 >10 mm 通常提示梗阻。'],
      refs: ['grays43', 'moore8', 'mujakovic2026'] },

    { id: 'bd-cystic', group: 'bile', zh: '胆囊管', latin: 'ductus cysticus', en: 'cystic duct',
      color: '#4aa564', radius: [0.18, 0.18, 0.20],
      points: [[0.95, -3.55, 0.35], [1.15, -4.80, -0.45], [1.35, -6.10, -1.65]],
      label: [1.15, -4.90, -0.40],
      bullets: ['长 2～4 cm，内有螺旋状黏膜皱襞（Heister 瓣），连接胆囊颈与肝总管。'],
      clinical: ['胆囊管过短或与肝总管平行走行时，腹腔镜手术易误伤肝总管。'],
      refs: ['grays43'] },

    /* ---------------- gallbladder ---------------- */
    { id: 'gb', group: 'gallbladder', zh: '胆囊', latin: 'vesica biliaris', en: 'gallbladder',
      color: '#79b06a', radius: [1.10, 1.22, 1.18, 1.00, 0.72, 0.44],
      points: [[0.15, -4.88, 4.15], [0.30, -4.60, 3.40], [0.50, -4.25, 2.40], [0.70, -3.95, 1.50], [0.90, -3.72, 0.60], [1.00, -3.60, -0.10]],
      label: [0.55, -4.20, 2.10],
      bullets: [
        '位于肝脏脏面的胆囊窝内，分底、体、颈及漏斗部，容量约 30～50 mL。',
        '体表投影在右锁骨中线与右肋弓交点（Murphy 点）附近。',
        '与十二指肠上部、横结肠右曲及肝右叶下面相邻。'
      ],
      clinical: ['胆囊颈部的哈德门袋（Hartmann 袋）易嵌顿结石，引起急性胆囊炎。'],
      refs: ['grays43', 'moore8', 'kostov2023'] },

    /* ---------------- systemic vein ---------------- */
    { id: 'ivc', group: 'vein', zh: '下腔静脉（肝后段）', latin: 'vena cava inferior', en: 'inferior vena cava (retrohepatic)',
      color: '#6c7fa8', radius: [1.40, 1.40, 1.42, 1.45],
      points: [[2.62, -7.00, -4.25], [2.62, -3.00, -4.35], [2.62, 1.50, -4.50], [2.62, 6.00, -4.72]],
      label: [2.62, -1.20, -4.40],
      bullets: ['走行于肝后面的下腔静脉沟内，仅以薄层结缔组织与肝实质相隔。',
                '收集三大肝静脉、尾状叶静脉及右后下静脉的血液。'],
      clinical: ['肝段下腔静脉最易在肝切除或外伤中受损；布加综合征即以此段肝静脉流出受阻为特征。'],
      refs: ['grays43', 'moore8', 'kostov2023'] },

    /* ---------------- ligaments & peritoneal reflections ---------------- */
    { id: 'lig-teres', group: 'ligament', zh: '肝圆韧带', latin: 'ligamentum teres hepatis', en: 'round ligament of liver',
      color: '#cfc7b4', radius: [0.30, 0.30, 0.28],
      points: [[-3.05, -2.90, 4.60], [-3.10, -2.60, 2.80], [-3.05, -2.55, 1.00], [-2.85, -2.60, -0.30]],
      label: [-3.05, -2.60, 1.60],
      bullets: ['是胚胎期脐静脉闭锁后的遗迹，走行于镰状韧带游离缘及肝圆韧带裂内。',
                '成人偶可再通，成为门体分流的侧支通路。'],
      clinical: ['门静脉高压时脐周静脉曲张（"海蛇头"）即经此韧带的脐旁静脉开放所致。'],
      refs: ['grays43', 'ta2'] },

    { id: 'lig-venosum', group: 'ligament', zh: '静脉韧带', latin: 'ligamentum venosum', en: 'ligamentum venosum',
      color: '#cfc7b4', radius: [0.20, 0.21, 0.22, 0.20],
      points: [[-1.55, -2.40, -2.30], [-1.10, 0.20, -3.50], [-0.20, 2.40, -4.20], [1.30, 3.90, -4.45]],
      label: [-0.90, 1.20, -3.80],
      bullets: ['胚胎期静脉导管（ductus venosus）闭锁后的遗迹，位于静脉韧带裂内。',
                '是尾状叶与左叶之间的表面标志。'],
      clinical: ['静脉韧带裂是尾状叶切除的重要边界。'],
      refs: ['grays43', 'ta2'] }
  ];

  /* ------------------------------------------------------------------ *
   * Surface features that can be identified by clicking the capsule
   * ------------------------------------------------------------------ */
  var SURFACE_FEATURES = [
    { id: 'diaphragmatic', zh: '膈面', latin: 'facies diaphragmatica', en: 'diaphragmatic surface',
      bullets: ['肝的上面，呈穹窿状凸向膈肌，分为前、上、右、后四部（依膈肌附着关系）。',
                '其上部借膈与右肺底、心包相邻，故肝脓肿可破入胸腔。'],
      point: [4.5, 7.6, 1.0], radius: 4.5 },
    { id: 'visceral', zh: '脏面（下面）', latin: 'facies visceralis', en: 'visceral surface',
      bullets: ['朝向下方与后方，与腹腔诸脏器相邻，表面可见多种压迹。',
                '中部有肝门（porta hepatis），左叶有肝圆韧带裂，右叶有胆囊窝与下腔静脉沟。'],
      point: [2.0, -4.0, 1.0], radius: 4.0 },
    { id: 'bare-area', zh: '裸区', latin: 'area nuda', en: 'bare area',
      bullets: ['肝后面无腹膜覆盖的区域，借疏松结缔组织直接与膈、右肾上腺及下腔静脉相邻。',
                '其上下缘分别为冠状韧带的上、下层，右侧为右三角韧带。'],
      point: [6.5, 2.5, -5.2], radius: 3.0 },
    { id: 'gallbladder-fossa', zh: '胆囊窝', latin: 'fossa vesicae biliaris', en: 'gallbladder fossa',
      bullets: ['位于肝下面右叶前缘的浅窝，容纳胆囊，其右侧为Ⅴ段、左侧为Ⅳb段。',
                '胆囊窝与下腔静脉左缘的连线即 Cantlie 线（主门静脉裂）。'],
      point: [0.6, -4.0, 1.6], radius: 2.2 },
    { id: 'teres-fissure', zh: '肝圆韧带裂', latin: 'fissura ligamenti teretis', en: 'fissure for the round ligament',
      bullets: ['肝下面左纵沟的前部，容纳肝圆韧带，是左内叶与左外叶的表面分界。',
                '其后端与肝门横沟相连。'],
      point: [-3.1, -2.3, 1.4], radius: 1.6 },
    { id: 'venosum-fissure', zh: '静脉韧带裂', latin: 'fissura ligamenti venosi', en: 'fissure for the ligamentum venosum',
      bullets: ['左纵沟的后部，容纳静脉韧带，将尾状叶与左叶分开。'],
      point: [-1.3, 0.9, -4.4], radius: 1.8 },
    { id: 'porta', zh: '肝门', latin: 'porta hepatis', en: 'porta hepatis',
      bullets: ['位于肝下面横沟内，长约 4 cm，是门静脉、肝固有动脉、肝管、淋巴管与神经出入肝的门户。',
                '门静脉位于后方；胆总管（肝管）位于门静脉右前方（略偏右），肝固有动脉位于门静脉左前方（略偏左）。该排列存在个体变异。',
                '向右延续为肝门横沟，向左达静脉韧带裂。'],
      point: [1.3, -3.0, -2.2], radius: 2.0 },
    { id: 'renal', zh: '右肾压迹', latin: 'impressio renalis', en: 'renal impression',
      bullets: ['肝下面右叶的宽浅凹陷，与右肾前面相贴。'],
      point: [7.8, -3.6, -1.1], radius: 2.4 },
    { id: 'suprarenal', zh: '肾上腺压迹', latin: 'impressio suprarenalis', en: 'suprarenal impression',
      bullets: ['位于肝下面右叶后部、肾压迹的内上方，与右肾上腺相贴。'],
      point: [5.3, -3.5, -3.3], radius: 1.8 },
    { id: 'colic', zh: '结肠压迹', latin: 'impressio colica', en: 'colic impression',
      bullets: ['与结肠右曲（肝曲）相邻的浅凹，位于右肾压迹的前下方。'],
      point: [8.3, -3.6, 1.9], radius: 2.0 },
    { id: 'duodenal', zh: '十二指肠压迹', latin: 'impressio duodenalis', en: 'duodenal impression',
      bullets: ['位于肝门右侧、胆囊颈附近，与十二指肠上部相邻。'],
      point: [3.4, -3.6, 1.1], radius: 1.8 },
    { id: 'gastric', zh: '胃压迹', latin: 'impressio gastrica', en: 'gastric impression',
      bullets: ['位于左叶下面，与胃前壁及小网膜相邻，是左叶下面最明显的凹陷。'],
      point: [-4.6, -2.2, 0.8], radius: 2.6 },
    { id: 'oesophageal', zh: '食管压迹', latin: 'impressio oesophagea', en: 'oesophageal impression',
      bullets: ['位于肝左叶后缘、静脉韧带裂附近，与食管腹段相邻。'],
      point: [-5.4, 2.3, -2.6], radius: 1.7 },
    { id: 'inferior-border', zh: '肝下缘', latin: 'margo inferior', en: 'inferior border',
      bullets: ['肝膈面与脏面的分界，前部锐利，在活体上随呼吸上下移动约 2～3 cm。',
                '正常成人右锁骨中线上肝下缘位于右肋弓后方，剑突下可触及 2～3 cm。'],
      point: [2.0, -3.9, 3.6], radius: 3.0 }
  ];

  /* ------------------------------------------------------------------ *
   * References (full strings are shown in the app and in REFERENCES.md)
   * ------------------------------------------------------------------ */
  var REFS = {
    ta2: 'FIPAT (Federative International Programme on Anatomical Terminologies). Terminologia Anatomica, 2nd edition (TA2). IFAA, 2019 — published online under CC BY-ND 4.0; https://ifaa.net/committees/anatomical-terminology-fipat/',
    grays43: 'Standring S, Tubbs SR (eds). Gray\u2019s Anatomy: The Anatomical Basis of Clinical Practice. 43rd ed. Elsevier, 2025. ISBN 978-0-443-12597-3 (e-book).',
    moore8: 'Moore KL, Dalley AF, Agur AMR. Clinically Oriented Anatomy. 8th ed. Wolters Kluwer / Lippincott Williams & Wilkins. ISBN 978-1-4963-5404-4.',
    kostov2023: 'Kostov S, Sel\u00e7uk I, Watrowski R, et al. Surgical anatomy of the liver \u2014 significance in ovarian cancer surgery. Diagnostics (Basel). 2023;13(14):2371. doi:10.3390/diagnostics13142371 (open access)',
    couinaud1957: 'Couinaud C. Le foie: \u00e9tudes anatomiques et chirurgicales. Paris: Masson et Cie, 1957.',
    strasberg2005: 'Strasberg SM. Nomenclature of hepatic anatomy and resections: a review of the Brisbane 2000 system. J Hepatobiliary Pancreat Surg. 2005;12(5):351-355. doi:10.1007/s00534-005-0999-7',
    brisbane2013: 'Strasberg SM, Phillips C. Use and dissemination of the Brisbane 2000 nomenclature of liver anatomy and resections. Ann Surg. 2013;257(3):377-382. doi:10.1097/SLA.0b013e31825a01f6',
    bismuth1982: 'Bismuth H. Surgical anatomy and anatomical surgery of the liver. World J Surg. 1982;6(1):3-9. doi:10.1007/BF01656368',
    michels1966: 'Michels NA. Newer anatomy of the liver and its variant blood supply and collateral circulation. Am J Surg. 1966;112(3):337-347. PMID 5917302',
    fonseca2017: 'Fonseca-Neto OCLD, Lima HCS, Rabelo P, et al. Anatomic variations of hepatic artery: a study in 479 liver transplantations. Arq Bras Cir Dig. 2017;30(1):35-37. PMID 28489166',
    fang2012: 'Fang CH, You JH, Lau WY, et al. Anatomical variations of hepatic veins: three-dimensional computed tomography scans of 200 subjects. World J Surg. 2012;36(1):120-124. doi:10.1007/s00268-011-1297-y',
    tolahunase2025: 'Tolahunase RS, Shanthi P, Rabi S. Anatomical variations of the hepatic veins: an observational study from a single cadaveric lab. Anat Cell Biol. 2025;58(3):365-372. doi:10.5115/acb.24.258',
    hajibandeh2023: 'Hajibandeh S, Kotb A, Evans L, et al. Procedural outcomes of laparoscopic caudate lobe resection: a systematic review and meta-analysis. Ann Hepatobiliary Pancreat Surg. 2023;27(1):6-19. doi:10.14701/ahbps.22-045',
    kalra2021: 'Kalra A, Yetiskul E, Wehrle CJ, Tuma F. Physiology, Liver. StatPearls [Internet]. Treasure Island (FL): StatPearls Publishing; 2023. PMID 30571059',
    mujakovic2026: 'Mujakovic E, Becirovic M, Terzic A, et al. Post-cholecystectomy changes in the common bile duct diameter: a comparative ultrasound study. Cureus. 2026;18(1):e100955. PMID 41658762',
    tutkuviene2024: 'Tutkuviene J, Navakauskaite A, Narutyte R, Brazaitis A. Hepatic portal vein branching patterns according to different liver assessment methods and classifications of branching type. Ann Anat. 2024;252:152204. doi:10.1016/j.aanat.2023.152204',
    luo2025: 'Luo W, Zeng X, Guo J, Wen S, et al. Right intrahepatic portal vein classification based on three-dimensional visualization, with particular attention to the relevance of the right anterior and right posterior portal vein. World J Surg. 2025;49(4):1101-1109. doi:10.1002/wjs.12541'
  };

  return { SEGMENTS: SEGMENTS, STRUCTURES: STRUCTURES, SURFACE_FEATURES: SURFACE_FEATURES, REFS: REFS };
});
