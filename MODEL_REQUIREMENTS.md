# 🤖 交互式大模型伴侣: 3D模型设计、骨骼绑定与表情动画技术需求清单
*(Interactive LLM Companion: 3D Model Design, Rigging & Animation Technical Specifications)*

为了确保 3D 虚拟伴侣在网页端 WebGL（如 Three.js）以及大语言模型（LLM）对话交互场景中具有极致的**表现力**、**流畅度**与**渲染性能**，特制定本 3D 建模与动画美术制作规范。

---

## 📌 一、 核心设计目标

1. **生动的面部表情 (Facial Expression)**: 支持语音同步（Lip-Sync 口型匹配）与丰富的情绪反馈（喜、怒、哀、乐、思考等）。
2. **自然的肢体动作 (Skeletal Animation)**: 具备待机、聆听、倾诉、手势互动等动画，支持动作融合，符合标准人型骨骼（Humanoid）。
3. **网页端高性能运行 (WebGL Optimization)**: 资源体量精简，加载迅速，在移动端与中低端设备上能够保持 60 FPS 稳定运行。

---

## 🎨 二、 3D 模型基础规范 (Mesh & Styling)

### 1. 资产基本信息
* **交付格式**: 首选 `.gltf` (分离式，便于调试) 或 `.glb` (单文件二进制，用于生产环境)，同时随同交付保存完整的源文件 `.max`, `.maya` 或 `.blend`。
* **单位系数**: **米 (Meters)**。角色身高建议在 1.5 米至 1.85 米之间。
* **坐标轴向**: **Y轴向上 (Y-Up)**，角色面朝向 **正Z方向 (+Z Front)**。角色底部中心点（双脚之间）定为世界原点 `(0, 0, 0)`。

### 2. 模型网格 (Topology & Triangle Counts)
* **面数限制 (Triangle Budget)**:
  * **高品质网页端 (HQ)**: 角色全身面数控制在 **1.5万 - 2.5万** 三角面 (Triangles) 之间。
  * **轻量跨端 (LQ)**: 控制在 **8000 - 1.2万** 三角面。
* **拓扑流向**: 
  * 头部与面部必须采用**环形拓扑拓扑流向 (Ring Topology)**，重点处理眼眶、口周、法令纹区域，以支持完美的表情变形（Blendshapes/Shapekeys）。
  * 关节处（肩、肘、膝、手腕）需提供足够的“环状分段（通常为3环）”，确保弯曲时网格不发生塌陷（Collapsing）。
  * 避免出现超过4边的多边形（N-Gons），全模型必须为纯四边形或预先烘焙好的三角面。

---

## 💄 三、 材质与贴图规范 (Materials & Textures)

### 1. 材质球与着色器 (Shading)
* **标准**: 全面采用物理渲染标准 **PBR (Physically Based Rendering)** 材质（Metal-Roughness 工作流）。
* **材质数量**: 建议控制在 **1 - 2 个材质球**（如：小面积透明/发光单列，全身主体共用 1 个）。
* **透明度管理**: 尽量避免使用大面积 Alpha Blend。头发、睫毛建议使用极简片状拓扑并采用 Alpha Cutoff（阈值裁剪），或使用不透明手绘卡渲风格，以彻底避免 WebGL 下深度排序错误产生的透视穿帮。

### 2. 贴图尺寸与格式 (Textures)
* **贴图分辨率**: 
  * 身体与服饰主体：**2048 x 2048** 像素。
  * 面部与头发细节：**1024 x 1024** 或 **2048 x 2048**。
* **通道合并 (Texture Packing)**:
  * 必须合并通道以减少纹理加载次数（Draw Calls）：
    * **R 通道**: 粗糙度 (Roughness)
    * **G 通道**: 金属度 (Metallic)
    * **B 通道**: 环境光遮蔽 (Ambient Occlusion)
  * 其他单独贴图：固有色基础贴图 (Base Color)、法线贴图 (Normal Mapping, 统一使用 OpenGL 格式即 Y+ 向)。

---

## 🦴 四、 骨骼绑定规范 (Rigging Setup)

为了适配大模型伴侣在闲聊中的肢体自然动作，角色的骨骼架构必须高度规范化，以便在使用 Web 动作库 (如 Mixamo、RPM 等) 时无需复杂的重定向工作。

```
                    [Hips (Root - 根骨骼)]
                             |
             +---------------+---------------+
             |                               |
          [LeftUpLeg]                    [RightUpLeg]
             |                               |
          [LeftLeg]                      [RightLeg]
             |                               |
          [LeftFoot]                     [RightFoot]
             |                               |
          [LeftToeBase]                  [RightToeBase]
                             |
                         [Spine (1-3)]
                             |
                         [Chest / UpperChest]
                             |
             +---------------+---------------+
             |               |               |
          [Collar]        [Neck]          [Collar]
             |               |               |
         [LeftShoulder]   [Head]       [RightShoulder]
             |                               |
         [LeftArm]                       [RightArm]
             |                               |
         [LeftForeArm]                   [RightForeArm]
             |                               |
         [LeftHand]                      [RightHand]
             |                               |
         手指骨骼 (Fingers)              手指骨骼 (Fingers)
```

### 1. 基本骨骼命名 (Humanoid Bone Naming)
骨骼命名及层级需**完全兼容 Unity Humanoid 规范 / Mixamo 规范**。请勿在核心骨骼上加自定义前缀，保持通用的骨骼树：
* **核心基础点**: `Hips`（必须是世界空间下角色的物理父级，可平移/旋转）。
* **脊椎与胸部**: `Spine`, `Spine1`, `Spine2`, `Chest`, `Neck`, `Head`。
* **上肢**: `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand` (右侧镜像 `RightShoulder` 等)。
* **下肢**: `LeftUpLeg`, `LeftLeg`, `LeftFoot`, `LeftToeBase` (右侧镜像 `RightUpLeg` 等)。
* **手指 (5指必需)**: 每一个手指需绑满 3 节指骨（如 `LeftHandThumb1,2,3`, `LeftHandIndex1,2,3` 等），手指的姿态在休眠时应呈现微握的自然放松态。

### 2. 权重蒙皮 (Weight Painting)
* **最大骨骼影响限制 (Influence Limit)**: 每一个网格顶点受骨骼影响的最大数量限制为 **4个 (4 Influences)**（用于兼容标准 WebGL/WebGL2 顶点着色器）。
* **平滑过渡**: 肩部、腋下、裆部及肘部的权重过渡需平滑（Smooth/Dual Quaternion-like），避免在动画平移和大幅度扭转时出现破面或尖锐褶皱。

---

## 🗣️ 五、 面部表情与 Blendshape (Morph Target) 规范

大模型伴侣的情感深度主要依靠“面部表情”来传达。我们采用业界标准的 **ARKit (Apple Unified Face Tracking)** 混合变形规范。

### 1. 核心口型与语音同步 (Lip-Sync Phonemes)
当大模型输出文本，系统将其转为语音序列时，需要高频调用口型混合变形。模型**必须**针对以下 9 组核心口型权重做精细制作：

| 口型名称 (Blendshape Name) | 对应发音说明 | 视觉表现 |
| :--- | :--- | :--- |
| `mouthOpen` | 基础大开口 `/a/` | 下颚向下张开，嘴型圆润，露出舌尖 |
| `mouthSmile` (L/R) | 微笑 `/e/`, `/i/` | 嘴角向外、斜上方拉伸，呈快乐态 |
| `mouthPucker` | 嘟嘴 `/o/`, `/u/` | 嘴唇向中间聚拢收缩，呈圆形凸起 |
| `mouthFunnel` | 吹哨口型、发 `/w/` 音 | 嘴唇边缘呈喇叭口状态张开，露出部分牙齿 |
| `mouthShrugUpper` | 惊讶/轻微张口鼻 | 上唇轻微上抬，配合情绪表达 |
| `mouthRollUpper` / `Lower` | 咬唇、发 `/f/`, `/v/` 音 | 嘴唇往牙齿内侧卷入，展现闭合张力 |

### 2. ARKit 情感关键 Blendshape 列表
为了保证 3D 伴侣能做出各种复合情绪（喜、怒、哀、乐、无奈、俏皮），除上述口型外，还必须设计以下 **24 个标志性 Blendshapes**：

* **眼部与眉毛 (Eyes & Brows)**:
  * `eyeBlinkLeft` / `eyeBlinkRight` (左右单眼眨眼): 用作自然的呼吸防干涩自动闪烁（极重要！）。
  * `eyeLookDownLeft/Right`, `eyeLookUpLeft/Right`, `eyeLookInLeft/Right`, `eyeLookOutLeft/Right`: 允许伴侣的眼珠追踪用户指针或移动视线。
  * `eyeSquintLeft` / `eyeSquintRight` (眯眼/疑惑/笑意眯眼)。
  * `eyeWideLeft` / `eyeWideRight` (张大眼睛/惊讶)。
  * `browDownLeft` / `browDownRight` (降低眉头/生气/忧郁)。
  * `browOuterUpLeft` / `browOuterUpRight` (抬高外眉梢/挑眉/疑惑)。
  * `browInnerUp` (抬高内眉梢/无辜/悲哀)。

* **口鼻与下巴 (Mouth & Jaw)**:
  * `jawOpen` (下巴自然张开，用于搭配其他动作形成大笑/惊愕)。
  * `mouthFrownLeft` / `mouthFrownRight` (嘴角拉平或向下，用于难过/不悦)。
  * `mouthStretchLeft` / `mouthStretchRight` (嘴角向两侧拉伸)。
  * `mouthLeft` / `mouthRight` (嘴巴整体向左偏/向右偏，用于调皮或思考)。
  * `cheekPuff` / `cheekSquintLeft/Right` (鼓腮帮子/面部笑肌隆起)。

> **💡 美术制作提示**: 
> 1. 表情模型的零位（Default State）必须是不露齿、眼睛微张的绝对自然放松态。
> 2. 所有 Blendshape 的名称推荐**完全采用驼峰命名法（Lower Camel Case）**，大小写格式需保持严格一致，避免大写字符导致的引擎解析异常。

---

## 🏃六、 伴侣核心动作与动画规范 (Animations)

在大模型伴侣中，动画是**异步事件响应式**的（例如：用户正在文字输入 -> 播放**思考动画**；模型开始回答 -> 播放**说话与肢体手势**；模型结束回答 -> 循环播放**待机呼吸动画**）。

### 1. 必选动画片段 (Technical Cliplist)
所有的动画片段需要导出为分离的、可以在运行时按需平滑过渡（Crossfade）的独立 Clip。

| 序号 | 动画 Clip 命名 | 循环属性 | 帧率 | 动画描述与交互触发时机 |
| :-: | :--- | :-: | :-: | :--- |
| **1** | `idle_default` | **Loop** | 30 FPS | **待机呼吸**: 极度微弱的胸廓起伏、重心轻微微调、偶发的自然眨眼。避免大幅度动作导致视觉干扰。 |
| **2** | `listening` | **Loop** | 30 FPS | **倾听状态**: 头部微偏，配合极其细微的点头、眼睛注视前方的聆听交互。 |
| **3** | `thinking` | **Loop** | 30 FPS | **思考状态**: 视线微微朝左上或右上倾斜，单手抚颏或食指轻触太阳穴，周期性切换。 |
| **4** | `talk_neutral`| **Loop** | 30 FPS | **温和陈述**: 配合日常交谈、配合基础肢体手势（如单手自然摊开、配合节奏点头）。 |
| **5** | `talk_excited`| **Loop** | 30 FPS | **兴奋反馈**: 双手轻微摊开，身体前倾，配合欢快的情绪手势（当用户赞美它或大模型聊到开心话题）。 |
| **6** | `greet` | **Once** | 30 FPS | **开场问候**: 挥手微笑，身体略微前倾，用于初次打开对话框。 |
| **7** | `sadness` | **Loop** | 30 FPS | **失落/委屈**: 抱臂轻微侧身、低头、视线向下移开（大模型致歉或谈及伤感话题时）。 |
| **8** | `agree_nod` | **Once** | 30 FPS | **认同点头**: 连续2下自然点头。动作结束需完美过渡回 `idle_default`。 |

### 2. 动画制作核心细节
* **帧率 (Frame Rate)**: 统一为 **30 FPS**。
* **物理烘焙**: 裙摆、长发、配饰等次级结构，若没有部署实时物理骨骼物理引擎，**必须在建模软件中人工烘焙（Bake Keyframes）**，确保飘飘的自然随动质感。
* **起始与结束帧 (Loop Match)**: 凡是标记为 **Loop** 的动作插片，其第一帧与最后一帧的关节位置、旋转量与缩放比例必须**绝对一致**，以防止在线上循环播放时出现视觉顿挫（Jittering）。

---

## ⚡ 七、 网页端部署与性能优化规范

为了使模型在 H5 / React 跑得流畅快速，导出最终 `.gltf` 阶段必须遵守以下几点优化细节：

1. **剔除冗余节点 (Clean Node Tree)**:
   * 清除场景中的无用相机（Cameras）、光源（Lights）、定位器、物理辅助刚体，只保留核心蒙皮网格（SkinnedMesh）与骨骼骨架（Bone/Skeleton）。
2. **多余动画数据清理 (Clean Animations)**:
   * 剔除非骨骼对象、非 Blendshape 属性的冗余动画曲线通道，减少 `.gltf` 文件的尺寸冗余。
3. **纹理压缩 (PBR Compressed Textures)**:
   * 对交付贴图在引擎层面采用 **Basis Universal (KTX2)** 纹理格式，能将显存大小压缩至 1/4 到 1/8。
4. **模型网格压缩 (Mesh Compression)**:
   * 必须支持 **Google Draco** 压缩格式。在保证极致几何细节的同时，降低文件在网络传输中的大小，使其压缩率达到 80%+。

---

## 🚀 八、 审查与测试验收清单 (QAD Checklist)

制作方在交付 3D 模型资源时，需按照以下清单自行测试 and 检查：
- [ ] 导出后模型在官方 [gltf-viewer](https://gltf-viewer.donmccurdy.com/) 或 [Babylon.js sandbox](https://sandbox.babylonjs.com/) 中渲染正常，无纹理缺失、发黑、破面。
- [ ] 确保在 `gltf-viewer` 的 morph targets 列表中，可以逐个拖动滑杆完美触发所有 `ARKit` 表情状态。
- [ ] 每一个动画 Clip 列表中，骨骼动画序列正常播放，循环动作第一帧和最后一帧完美拼合无抖动。
- [ ] 检查并确保所有骨骼命名和层级大小写规范，无拼写错误（如：`LeftForearm` 不要错写为 `LtFoream`）。
