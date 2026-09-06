// グローバル設定（仕様1.5）

export const DEFAULT_SETTINGS = Object.freeze({
  setSize: 20,
  scope: 'review',
  shuffleAll: true,
  firstInterval: 1,
  secondInterval: 6,
  intervalFactor: 1.0,
  efInitial: 2.5,
  efMin: 1.3,
  efGainOnCorrect: 0.1,
  efLossOnIncorrect: 0.2,
  partialThreshold: 0.5,
  partialIntervalFactor: 1.0,
  orderingScoreMethod: 'concordance',
  lastExportedAt: null,
});

/** バックアップ警告のしきい値（日） */
export const BACKUP_WARN_DAYS = 14;

export const SETTING_FIELDS = [
  { key: 'setSize', label: 'セットの問題数', type: 'int', min: 1, max: 100, nullable: true,
    hint: '1〜100。「設定なし」で対象カード全件' },
  { key: 'scope', label: '出題範囲', type: 'enum', options: [['review', '復習'], ['all', '全て']] },
  { key: 'shuffleAll', label: '「全て」の順序ランダム化', type: 'bool' },
  { key: 'firstInterval', label: '初回間隔（日）', type: 'int', min: 1, max: 3650 },
  { key: 'secondInterval', label: '2回目間隔（日）', type: 'int', min: 1, max: 3650 },
  { key: 'intervalFactor', label: '間隔倍率', type: 'float', min: 0.1, max: 5.0 },
  { key: 'efInitial', label: 'EF初期値', type: 'float', min: 1.3, max: 5.0 },
  { key: 'efMin', label: 'EF下限', type: 'float', min: 1.0, max: 5.0 },
  { key: 'efGainOnCorrect', label: '正解時EF加算', type: 'float', min: 0, max: 1 },
  { key: 'efLossOnIncorrect', label: '不正解時EF減算', type: 'float', min: 0, max: 1 },
  { key: 'partialThreshold', label: '部分正解しきい値', type: 'float', min: 0, max: 1,
    hint: '一致率がこの値以上1.0未満で部分正解' },
  { key: 'partialIntervalFactor', label: '部分正解時の間隔倍率', type: 'float', min: 0.1, max: 5.0,
    hint: '1.0で据え置き' },
  { key: 'orderingScoreMethod', label: '順番当てのスコア算出', type: 'enum',
    options: [['concordance', '相対順序一致率'], ['position', '位置一致率']] },
];

export function withDefaults(settings) {
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}
