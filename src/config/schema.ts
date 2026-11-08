/** --dump-config-schema：给编辑器/校验器用的最小 JSON Schema。 */
export function configSchema(): Record<string, unknown> {
  const row = {
    type: 'object',
    required: ['id', 'use'],
    additionalProperties: false,
    properties: {
      id: { type: 'string', description: '插件树中的唯一行 id，patch 按它定位' },
      use: { type: 'string', description: '插件工厂名' },
      config: { type: 'object', description: '传给插件工厂的配置（整体替换，不深合并）' },
      enabled: { type: 'boolean', description: 'false 则该行不挂载' },
      layer: { type: 'string', description: '组合时写入的溯源层（只读）' },
    },
  };
  const patchOp = {
    type: 'object',
    required: ['op'],
    properties: {
      op: { type: 'string', enum: ['replace', 'insert', 'remove'] },
      id: { type: 'string' },
      row,
      before: { type: 'string' },
      after: { type: 'string' },
    },
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ts-dsh config row & patch',
    description: '对齐上游 cordis.patch.yml 的 replace/insert/remove 语义，本复用 JSON 表达。',
    type: 'object',
    properties: {
      configRow: row,
      patch: {
        type: 'object',
        required: ['ops'],
        properties: {
          name: { type: 'string' },
          ops: { type: 'array', items: patchOp },
        },
      },
      patchFile: {
        description: 'patch 文件也可直接是一个 PatchOp 数组',
        type: 'array',
        items: patchOp,
      },
    },
  };
}
