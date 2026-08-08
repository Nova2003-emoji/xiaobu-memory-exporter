(function (global) {
  'use strict';

  const now = Date.now();
  const hour = 3600_000;
  const demo = {
    meta: {
      format: 'xiaobu-memory-export-demo-v1',
      parsedAt: new Date(now).toISOString(),
      demo: true,
      appInfo: {
        android_version: '16',
        app_version: '16.10.1',
        coloros_version: '38',
        database_version: 46,
        flavor: 'domestic'
      }
    },
    collections: [
      { collectionId: 'demo-study', collectionName: '学习方法', description: '合成演示合集' },
      { collectionId: 'demo-health', collectionName: '健康与运动', description: '合成演示合集' },
      { collectionId: 'demo-tools', collectionName: '数字工具', description: '合成演示合集' },
      { collectionId: 'demo-life', collectionName: '生活灵感', description: '合成演示合集' }
    ],
    memories: [
      {
        memoryId: 'demo-001', createdTime: now - hour, updateTime: now - hour,
        appName: '演示来源', packageName: 'demo.app',
        title: '把复杂任务拆成下一步动作',
        summary: '合成示例：先明确交付物，再把当前阻塞点缩小成一个能在十五分钟内启动的动作。',
        keywords: ['任务拆解', '执行力', '学习'], dataText: '这是公开仓库中的合成数据，不来自任何真实用户备份。\n\n示例正文：把“写完报告”改写成“先列出三个核心结论”，启动阻力会更低。',
        deeplink: '', screenshot: '', audioFile: '', imageCount: 0, dataSource: 'demo', sceneName: 'article_info', sceneType: ['学习'],
        labels: ['学习方法', '执行'], collectionIds: ['demo-study'], collectionNames: ['学习方法'], attachmentCount: 0, attachments: [], entities: []
      },
      {
        memoryId: 'demo-002', createdTime: now - 5 * hour, updateTime: now - 5 * hour,
        appName: '演示来源', packageName: 'demo.app',
        title: '复习时优先做主动回忆',
        summary: '合成示例：重新阅读容易产生熟悉感，闭卷回忆和测试更能暴露真正不会的地方。',
        keywords: ['主动回忆', '复习'], dataText: '示例正文：先合上资料写出你记得的结构，再打开原文补缺口。',
        deeplink: '', screenshot: '', audioFile: '', imageCount: 0, dataSource: 'demo', sceneName: 'article_info', sceneType: ['学习'],
        labels: ['学习方法', '记忆'], collectionIds: ['demo-study'], collectionNames: ['学习方法'], attachmentCount: 0, attachments: [], entities: []
      },
      {
        memoryId: 'demo-003', createdTime: now - 22 * hour, updateTime: now - 22 * hour,
        appName: '演示短视频', packageName: 'demo.video',
        title: '久坐后做一组轻量活动',
        summary: '合成示例：每隔一段时间起身活动，重点不是追求训练强度，而是打断长时间静止。',
        keywords: ['久坐', '活动'], dataText: '示例正文：走动几分钟、活动肩颈和髋部，根据自己的身体状态选择舒适范围。',
        deeplink: '', screenshot: '', audioFile: '', imageCount: 0, dataSource: 'demo', sceneName: 'video_info', sceneType: ['健康'],
        labels: ['健康', '运动'], collectionIds: ['demo-health'], collectionNames: ['健康与运动'], attachmentCount: 0, attachments: [], entities: []
      },
      {
        memoryId: 'demo-004', createdTime: now - 2 * 86400_000, updateTime: now - 2 * 86400_000,
        appName: '演示网页', packageName: 'demo.browser',
        title: '本地优先的个人资料库',
        summary: '合成示例：重要私人资料可以优先在本地完成解析、检索和导出，减少不必要的数据上传。',
        keywords: ['本地优先', '隐私'], dataText: '示例正文：这个项目本身也采用本地优先设计——备份文件不会被发送到远程服务器。',
        deeplink: 'https://example.com/demo-local-first', screenshot: '', audioFile: '', imageCount: 0, dataSource: 'demo', sceneName: 'article_info', sceneType: ['工具'],
        labels: ['隐私', '工具'], collectionIds: ['demo-tools'], collectionNames: ['数字工具'], attachmentCount: 0, attachments: [], entities: []
      },
      {
        memoryId: 'demo-005', createdTime: now - 4 * 86400_000, updateTime: now - 4 * 86400_000,
        appName: '演示随口记', packageName: 'demo.note',
        title: '周末想去逛一个安静的展览',
        summary: '合成示例：记录一个以后想做的小计划。',
        keywords: ['周末', '展览'], dataText: '示例正文：找一个人少、能慢慢看的展览，回来后把最喜欢的三个作品记下来。',
        deeplink: '', screenshot: '', audioFile: '', imageCount: 0, dataSource: 'demo', sceneName: 'note', sceneType: ['生活'],
        labels: ['生活', '灵感'], collectionIds: ['demo-life'], collectionNames: ['生活灵感'], attachmentCount: 0, attachments: [], entities: []
      },
      {
        memoryId: 'demo-006', createdTime: now - 8 * 86400_000, updateTime: now - 8 * 86400_000,
        appName: '演示网页', packageName: 'demo.browser',
        title: '给收藏内容留下可搜索的标题',
        summary: '合成示例：标题最好能说明“这是什么”和“为什么以后会找它”。',
        keywords: ['检索', '标题'], dataText: '示例正文：与其叫“好东西”，不如叫“浏览器本地读取文件夹的方法”。',
        deeplink: '', screenshot: '', audioFile: '', imageCount: 0, dataSource: 'demo', sceneName: 'article_info', sceneType: ['工具'],
        labels: ['知识管理', '检索'], collectionIds: ['demo-tools'], collectionNames: ['数字工具'], attachmentCount: 0, attachments: [], entities: []
      },
      {
        memoryId: 'demo-007', createdTime: now - 12 * 86400_000, updateTime: now - 12 * 86400_000,
        appName: '演示短视频', packageName: 'demo.video',
        title: '练习时给动作设一个简单反馈指标',
        summary: '合成示例：不只记录“做没做”，也可以记录稳定性、次数或完成感受。',
        keywords: ['训练', '反馈'], dataText: '示例正文：每次训练只选择一个指标观察，避免把记录本身变成额外负担。',
        deeplink: '', screenshot: '', audioFile: '', imageCount: 0, dataSource: 'demo', sceneName: 'video_info', sceneType: ['健康'],
        labels: ['运动', '复盘'], collectionIds: ['demo-health'], collectionNames: ['健康与运动'], attachmentCount: 0, attachments: [], entities: []
      },
      {
        memoryId: 'demo-008', createdTime: now - 18 * 86400_000, updateTime: now - 18 * 86400_000,
        appName: '演示随口记', packageName: 'demo.note',
        title: '读完一篇长文后写一句自己的判断',
        summary: '合成示例：收藏不是终点，留下一句自己的判断更方便以后重新进入上下文。',
        keywords: ['阅读', '笔记'], dataText: '示例正文：我为什么保存它？它改变了哪个判断？下一次在哪个场景会用到？',
        deeplink: '', screenshot: '', audioFile: '', imageCount: 0, dataSource: 'demo', sceneName: 'note', sceneType: ['学习'],
        labels: ['阅读', '知识管理'], collectionIds: ['demo-study'], collectionNames: ['学习方法'], attachmentCount: 0, attachments: [], entities: []
      }
    ]
  };

  global.XIAOBU_DEMO_DATA = demo;
  if (typeof module !== 'undefined' && module.exports) module.exports = demo;
})(typeof globalThis !== 'undefined' ? globalThis : this);
