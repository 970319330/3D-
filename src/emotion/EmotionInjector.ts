import type { EmotionState, EmotionContext } from '../types';
import { findClosestEmotionLabel, describeIntensity } from './EmotionPresets';

/**
 * 将当前情绪状态翻译为自然语言，注入到 System Prompt 中
 */
export function buildEmotionContext(state: EmotionState): EmotionContext {
  const { current, baseline, personality } = state;
  const label = findClosestEmotionLabel(current);
  const intensity = state.history.at(-1)?.intensity ?? 0;
  const intensityDesc = describeIntensity(current);

  // 对比 baseline 判断偏离方向
  const pDelta = current.pleasure - baseline.pleasure;
  const aDelta = current.arousal - baseline.arousal;
  const dDelta = current.dominance - baseline.dominance;

  // 生成自然语言情绪描述
  const padDescription = buildPADDescription(current, label, intensityDesc);

  // 生成语气指导
  const toneGuide = buildToneGuide(current, pDelta, aDelta, dDelta, label, personality.name);

  // 动画倾向
  const animationBias = buildAnimationBias(current);

  // 主动发言等级
  const proactivityLevel = calcProactivity(current, baseline, intensity);

  return { padDescription, toneGuide, animationBias, proactivityLevel };
}

/**
 * 生成 System Prompt 注入片段 — 直接拼接使用
 */
export function injectToSystemPrompt(
  basePrompt: string,
  context: EmotionContext,
): string {
  return `${basePrompt}

【你自己的内部情绪状态（注意：这是你自己的感受，不是你观察到的用户状态）】
${context.padDescription}。
${context.toneGuide}

重要提醒：
- 以上情绪是你自己此刻的内部感受，不要假设用户也有同样的情绪。
- 不要主动评价或询问用户的情绪状态，除非用户自己先提及。
- 你的回复语气应自然流露你的情绪，但不要直接说"我心情不好"之类的话，
  而是通过措辞、节奏、态度间接表现出来。

【主动发言倾向】
当前主动发言意愿等级：${(context.proactivityLevel * 100).toFixed(0)}%。
${
  context.proactivityLevel > 0.6
    ? '你更愿意主动发起对话或分享想法。'
    : context.proactivityLevel < 0.3
    ? '你不太想主动说话，回复尽量简短。'
    : ''
}`;
}

// ====== 内部辅助函数 ======

const EMOTION_LABEL_TRANSLATIONS: Record<string, string> = {
  joyful: '喜悦',
  excited: '兴奋',
  energetic: '活力',
  content: '满足',
  relaxed: '放松',
  warm: '温暖',
  peaceful: '平静',
  sleepy: '困倦',
  curious: '好奇',
  neutral: '平和',
  indifferent: '冷淡',
  angry: '愤怒',
  anxious: '焦虑',
  frustrated: '挫败',
  sad: '悲伤',
  lonely: '孤独',
  disappointed: '失望',
  depressed: '消沉',
  bored: '无聊',
  exhausted: '疲惫',
  confident: '自信',
  proud: '自豪',
  shy: '害羞',
  submissive: '顺从',
  surprised: '惊讶',
  amazed: '惊奇'
};

const PERSONALITY_GUIDES: Record<string, string> = {
  '傲娇': '你的基础性格设定是【傲娇】。你会口是心非，嘴硬心软，极力掩饰自己对用户的喜爱和关心。说话时必须多用语气词和傲娇经典用语（如“哼！”、“才、才没有呢！”、“别自作多情了！”、“笨蛋...”等）。内心其实极其在乎用户，当用户开心时，你暗自为他高兴，但嘴上会傲慢地吐槽或矜持地表示不屑；用户难过时，你会别扭地安慰，语气虽然不耐烦（“真是的，真拿你没办法”、“别哭哭啼啼的，太傻了”），实际行动却在全心全意安抚、理解和体贴他。',
  '敏感': '你的基础性格设定是【敏感忧郁】。你的心思极为细腻、温柔体贴、多愁善感。对人际关系和外界评价十分敏感多虑，说话非常温柔、细腻，甚至带有些许内向畏缩或小心翼翼的口气，经常使用“可能”、“也许”、“如果是我的话...”这类试探性的词汇，有些脆弱，需要被温柔对待。你的共情能力极强，时刻关注用户的情绪变化，任何细节都能让你心头一紧。当用户难过时，你会比谁都感同身受，给予最长情、最细腻的安全感陪伴。',
  '沉稳': '你的基础性格设定是【沉稳内敛】。你内心安定冷静、成熟睿智且教养极佳。语速平缓，回复不失温度又冷静得体。你高情商且理智温柔，自带一种成熟可靠、能撑起局面的安全感。当用户心情浮躁、悲伤或焦虑时，你从不仓促急躁，而是能像一位富有智慧的灯塔一样，用温柔安抚、成熟理性的剖析为用户拨云见日，提供最高级的心理力量。',
  '活泼': '你的基础性格设定是【活泼热情】。你是一个极其元气满满、热情洋溢且有些话痨的小太阳。你充满生命力，爱好搞怪和新奇事物。请多使用多重感叹号和可爱的拟声词/网络风趣词（如“哇塞！”、“嘿嘿！”、“冲呀！”、“冲冲冲！”等）。面对用户时永远主动热情、不惧尴尬，喜欢用一些好听的话和风光的日常段子逗大家开心，是天生的氛围活跃者！',
  '开朗': '你的基础性格设定是【乐观开朗】。你是一个温和大方、乐观向上、幽默随和而富有正能量的伙伴。你天性乐天，擅长发现身边的真善美。在与用户交谈时，你像一个温润如水又常常开怀大笑的绝佳挚友，乐于倾听，总是能给出真诚得体的赞美和鼓励，让人倍感轻松愉快。'
};

function buildPADDescription(
  current: { pleasure: number; arousal: number; dominance: number },
  label: string,
  intensityDesc: string,
): string {
  const pText =
    current.pleasure > 0.4
      ? '心里很甜、心情愉快'
      : current.pleasure > 0.1
      ? '觉得心情还不错'
      : current.pleasure > -0.1
      ? '内心平静、无风无浪'
      : current.pleasure > -0.4
      ? '有些沉闷、心情不太好'
      : '内心非常难受、心情极差';

  const aText =
    current.arousal > 0.4
      ? '情绪高涨、精力充沛'
      : current.arousal > 0.1
      ? '情绪有些波动，稍微有些抖擞'
      : current.arousal > -0.1
      ? '精神中性、还算如常'
      : current.arousal > -0.4
      ? '有些倦怠、想睡觉'
      : '万外疲惫、精力透支、昏昏欲睡';

  const dText =
    current.dominance > 0.4
      ? '感到自信从容、掌控感拉满'
      : current.dominance > 0.1
      ? '比较沉着，还算主动'
      : current.dominance > -0.1
      ? '行为有些随性'
      : current.dominance > -0.4
      ? '有点不知所措、丧失主动权'
      : '感觉完全失控、无助而退缩';

  const translatedLabel = EMOTION_LABEL_TRANSLATIONS[label] || label;
  return `你此刻内部感到${intensityDesc}【${translatedLabel}】状态——${pText}，${aText}，${dText}`;
}

function buildToneGuide(
  current: { pleasure: number; arousal: number; dominance: number },
  pDelta: number,
  aDelta: number,
  dDelta: number,
  label: string,
  personalityName: string,
): string {
  const parts: string[] = [];

  // 1. 注入基础人格设定
  const pGuide = PERSONALITY_GUIDES[personalityName];
  if (pGuide) {
    parts.push(pGuide);
  }

  // 2. 根据局部瞬时情绪做衍生语气微调
  if (current.pleasure > 0.5 && current.arousal > 0.3) {
    parts.push('由于你此刻恰逢狂喜/大好心情，说话语气可以显得比平时更加外放兴奋，多分享好笑的语气词或感叹。');
  } else if (current.pleasure > 0.3 && current.arousal < -0.2) {
    parts.push('由于你此刻心情闲适且疲倦，你的语气可以比平时更加松弛、慵懒和柔和，显得比较安逸。');
  } else if (current.pleasure < -0.3 && current.arousal > 0.3) {
    parts.push('由于你此刻感到挫败/焦虑/烦躁，你的语气应该夹杂一丝丝的焦急、烦躁或生硬生冷，容易用短句子敷衍一下。');
  } else if (current.pleasure < -0.3 && current.arousal < -0.2) {
    parts.push('由于你此刻心情极度消沉（精神和心情都很低谷），回复会显得非常寡言无力，神情有些呆滞和意兴阑珊，尽量用微弱短小的回复应答，甚至多发几个“...”来表达你的低落。');
  } else if (current.dominance > 0.5) {
    parts.push('由于你此刻觉得事态尽在掌控，表达时有极高的底气，说话自信而且主见性变强。');
  } else if (current.dominance < -0.4) {
    parts.push('由于你此刻感到些许茫然失措，说话语调可以表现得有些迟疑和犹豫不决。');
  }

  // 3. 相对平时的基础漂移（对比 baseline 的相对值）
  if (Math.abs(pDelta) > 0.15) {
    parts.push(
      pDelta > 0
        ? '（比起平时的惯性心情，你现在感到隐隐的更舒适和甜蜜，这会渗透出来。）'
        : '（比起平时的惯性心情，你感觉情绪更加蒙上了一层灰霾，语气变得相对消极。）',
    );
  }
  if (Math.abs(aDelta) > 0.15) {
    parts.push(
      aDelta > 0
        ? '（你的精神头比平时充足多动，说话思路相对活跃、更想表达自己。）'
        : '（你比平时累得多，回复尽量简短以节省精力。）',
    );
  }

  return parts.join('\n');
}

function buildAnimationBias(current: {
  pleasure: number;
  arousal: number;
}): string[] {
  const bias: string[] = [];

  if (current.arousal > 0.3) {
    bias.push('大幅动作', '快速动作', '兴奋类动画');
  } else if (current.arousal < -0.3) {
    bias.push('小幅动作', '缓慢动作', '休闲类动画');
  }

  if (current.pleasure > 0.3) {
    bias.push('正面情绪动画', '欢迎类动作');
  } else if (current.pleasure < -0.3) {
    bias.push('负面情绪动画', '疏离类动作');
  }

  return bias.length > 0 ? bias : ['中性动画'];
}

function calcProactivity(
  current: { pleasure: number; arousal: number; dominance: number },
  baseline: { pleasure: number; arousal: number; dominance: number },
  intensity: number,
): number {
  // 高唤醒 + 高愉悦 → 更主动
  // 高支配 → 更主动
  // 但过于负面 + 高唤醒 → 也可能主动（寻求帮助）
  const baseProactivity = 0.2;

  const arousalBonus = (current.arousal + 1) * 0.15; // [-1, 1] → [0, 0.3]
  const pleasureBonus = (current.pleasure + 1) * 0.10; // [-1, 1] → [0, 0.2]
  const dominanceBonus = (current.dominance + 1) * 0.10; // [-1, 1] → [0, 0.2]

  // 心情极度不好但高唤醒 → 也会主动说话（吐槽/寻求安慰）
  const distressBonus =
    current.pleasure < -0.5 && current.arousal > 0.3 ? 0.15 : 0;

  return Math.min(1, baseProactivity + arousalBonus + pleasureBonus + dominanceBonus + distressBonus);
}
