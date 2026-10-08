-- =====================================================================
-- 超级展业系统 数据库 Schema（demo，v2.0 零收费积分闭环版）
-- 需求来源   : DOC/超级展业系统-需求分析-v2.0.md (2026-09-27)
--             DOC/demo-database-design.md（v1.0 结构设计基础）
-- 适用版本   : MySQL 8.0+（使用 JSON 类型；5.7 可将 JSON 降级为 LONGTEXT）
-- 存储引擎   : InnoDB
-- 字符集     : utf8mb4 / utf8mb4_0900_ai_ci
-- 库名       : super-sales-db
--
-- v2.0 相对 v1.0 的结构变更:
--   [删] user.pay_password_hash / pay_password（全平台无支付入口，§2.4 架构约束）
--   [改] tier: 积分门槛档位 → L0~L3 会员等级（行为晋级，FR-2.x）
--   [改] pos_task: 增加安装模式/达标监控/近30天流水/退机状态（FR-3.x）
--   [改] point_flow: flow_type 枚举扩充、增加规则版本/有效期/顺延标记（§7）
--   [改] product/mall_order: 成本校验、等级池、限购、履约与售后字段（FR-5.x）
--   [改] dividend_record/room_rebuild: 增加 round_no，支持无限次循环（FR-10.4）
--   [新] 入队名额 team_slot / 再入队 team_reentry（替代 v1.0 缴费订单）
--   [新] 积分有效期批次 point_expire_batch（FR-4.4 12 个月过期）
--   [新] 任务域 task_template / user_task（FR-7.x 配置化，替代 v1.0 自主领取）
--   [新] 赠送域 gift_activity / gift_record（FR-8.x 预算硬控/双人审批）
--   [新] 分润池 profit_pool_config / profit_pool_ledger / profit_pool_daily（§2.5/FR-12.9）
--   [新] 收单结算 acq_settle_batch / acq_settle_item（B 端对公，达标与入池依据）
--   [新] 风控 risk_record（FR-6.5/FR-12.7）
--   [新] 工程辅助 dead_letter（死信）/ reconcile_diff（对账差异，FR-12.6）
--
-- 全局约定:
--   1. 积分一律 BIGINT 整数，资金类字段不使用浮点；金额类 DECIMAL(12,2)；
--   2. 一切积分变动必须落 point_flow 流水（flow_no 为幂等键）；
--   3. 流水/日志类表只增不改不删；
--   4. 实体状态由 status 字段控制，核心表不做物理软删除；
--   5. 时间字段统一 DATETIME；created_at / updated_at 为通用审计字段；
--   6. 系统不集成任何面向用户的支付/打款能力（无支付表、无提现表）。
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `super-sales-db`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE `super-sales-db`;

-- =====================================================================
-- 一、用户域
-- =====================================================================

-- 1.1 C端用户（FR-1.1 注册 / FR-1.4 推荐关系 / FR-1.6 商户登记）
CREATE TABLE `user` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `phone`             VARCHAR(20)     NOT NULL COMMENT '手机号（注册即绑定，全局唯一；v2.0 手机号注册制）',
  `password_hash`     VARCHAR(128)    NULL     COMMENT '登录密码哈希（可空，手机号+验证码登录时为空）',
  `nickname`          VARCHAR(64)     NOT NULL DEFAULT '' COMMENT '昵称',
  `avatar`            VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '头像URL',
  `invite_code`       VARCHAR(16)     NOT NULL COMMENT '推荐码（全局唯一，注册时生成）',
  `referrer_id`       BIGINT UNSIGNED NULL     COMMENT '直接推荐人ID（注册时绑定，终身不可变更，Q18 首次纠错待确认）',
  `level`             TINYINT         NOT NULL DEFAULT 0 COMMENT '会员等级: 0=L0普通 1=L1基础 2=L2高级 3=L3钻石（达标自动晋级，只升不降 Q14）',
  `level_updated_at`  DATETIME        NULL     COMMENT '最近晋级时间',
  `ancestor_chain`    JSON            NULL     COMMENT '祖先链快照 [{level, user_id}]（≤3级计奖链冗余，FR-6.1）',
  `merchant_category` VARCHAR(64)     NOT NULL DEFAULT '' COMMENT '经营类目（小微商户登记，装机审核与风控）',
  `store_info`        JSON            NULL     COMMENT '门店/摊位信息（地址/摊位号等，非收费环节）',
  `real_name_status`  TINYINT         NOT NULL DEFAULT 0 COMMENT '实名状态: 0未实名 1已实名（Q7 商户真实性核验）',
  `status`            TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1正常 0禁用 -1封禁（风控命中）',
  `last_login_at`     DATETIME        NULL     COMMENT '最后登录时间',
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册（创建）时间',
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invite_code` (`invite_code`),
  UNIQUE KEY `uk_phone` (`phone`),
  KEY `idx_referrer` (`referrer_id`),
  KEY `idx_level` (`level`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = 'C端用户（v2.0：无支付字段，等级=行为晋级）';

-- 1.2 会员等级变更流水（FR-2.1 自动晋级留痕 / FR-2.6 分润资格审计）
CREATE TABLE `user_level_record` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id`         BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `from_level`      TINYINT         NOT NULL COMMENT '变更前等级（0~3）',
  `to_level`        TINYINT         NOT NULL COMMENT '变更后等级（0~3）',
  `trigger_type`    VARCHAR(32)     NOT NULL COMMENT '触发: QUALIFIED装机达标 REACH_RECOMMEND推荐达标人数 POINTS累计积分 ADMIN人工干预',
  `trigger_biz_id`  VARCHAR(64)     NOT NULL DEFAULT '' COMMENT '触发业务ID（机器SN/统计快照说明）',
  `snapshot`        JSON            NULL     COMMENT '晋级条件快照（达标机器SN/直推达标人数/积分累计值）',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '晋级时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_time` (`user_id`, `created_at`),
  UNIQUE KEY `uk_user_to_trigger` (`user_id`, `to_level`, `trigger_biz_id`) COMMENT '同一等级同一触发源不重复晋级（幂等）'
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '会员等级变更流水（只增，FR-2.1/审计）';

-- =====================================================================
-- 二、会员等级配置域（FR-2.x，替代 v1.0 积分门槛档位）
-- =====================================================================

-- 2.1 会员等级配置（L0~L3，晋级条件与权益系数可配，FR-2.5 版本化）
CREATE TABLE `tier` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '等级ID（固定 4 行：L0~L3）',
  `level_no`            TINYINT         NOT NULL COMMENT '等级序号: 0/1/2/3（L0~L3）',
  `name`                VARCHAR(32)     NOT NULL COMMENT '等级名称（普通/基础/高级/钻石）',
  `reach_condition`     JSON            NOT NULL COMMENT '晋级条件（满足其一）：{"qualified_machine":1,"reach_recommend":2,"cumulative_points":3000}',
  `reward_factor`       DECIMAL(5, 2)   NOT NULL DEFAULT 1.00 COMMENT '奖励积分系数: L0 无资格 / L1 1.0 / L2 1.5 / L3 2.0（FR-2.2）',
  `mall_pool`           VARCHAR(16)     NOT NULL DEFAULT 'NORMAL' COMMENT '商城商品池: TRIAL体验池(NORMAL/L2/L3 专属池见 min_level)',
  `tag_name`            VARCHAR(32)     NOT NULL DEFAULT '' COMMENT '身份标签文案（FR-2.3 展示）',
  `tag_color`           VARCHAR(16)     NOT NULL DEFAULT '#999999' COMMENT '身份标签颜色（HEX）',
  `version`             INT             NOT NULL DEFAULT 1 COMMENT '规则版本（后台变更递增，FR-2.5）',
  `status`              TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1启用 0停用',
  `created_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_level_no` (`level_no`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '会员等级配置（v2.0 行为晋级，FR-2.x）';

-- =====================================================================
-- 三、POS 机安装与达标域（FR-3.x）
-- =====================================================================

-- 3.1 POS 机（FR-3.1 机器登记 / FR-3.2 安装模式 / FR-3.3 达标监控 / FR-3.7 退机）
CREATE TABLE `pos_task` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'POS机ID',
  `user_id`            BIGINT UNSIGNED NOT NULL COMMENT '归属用户ID（机器与用户 1:1 申请制）',
  `sn`                 VARCHAR(64)     NOT NULL COMMENT '机器SN（全局唯一）',
  `install_mode`       TINYINT         NOT NULL DEFAULT 1 COMMENT '安装模式: 1平台(服务商)安装 2用户自装（两种模式奖励一致）',
  `platform`           VARCHAR(32)     NOT NULL COMMENT '收单平台',
  `model`              VARCHAR(64)     NOT NULL COMMENT '机器型号',
  `proof_images`       JSON            NULL     COMMENT '上传资料（图片/凭证URL数组，装机审核）',
  `installed_at`       DATETIME        NOT NULL COMMENT '装机确认时间（达标25天窗口起点）',
  `due_at`             DATETIME        NOT NULL COMMENT '达标截止 = 装机确认 + 25 天',
  `cumulative_flow`    DECIMAL(12, 2)  NOT NULL DEFAULT 0 COMMENT '累计交易流水（元，T+1 收单对账归集，FR-3.3）',
  `month_flow`         DECIMAL(12, 2)  NOT NULL DEFAULT 0 COMMENT '当月真实交易流水（月度流水任务/达标率任务用，FR-7.x）',
  `last_trade_at`      DATETIME        NULL     COMMENT '最近一笔真实交易时间（再入队"持续运营"校验，FR-9.9）',
  `fake_flag`          TINYINT         NOT NULL DEFAULT 0 COMMENT '收单机构风控标记: 0正常 1疑似虚假流水（达标判定排除，风险3对策）',
  `qualified_at`       DATETIME        NULL     COMMENT '达标时间（25天内累计≥1000元；NULL=未达标；达标触发四元组结算）',
  `unqualified_recycled` TINYINT       NOT NULL DEFAULT 0 COMMENT '未达标冻结积分是否已回收: 0未 1已（FR-3.6）',
  `machine_status`     TINYINT         NOT NULL DEFAULT 1 COMMENT '机器状态: 1运营中 2已退机 3失效（FR-3.7）',
  `returned_at`        DATETIME        NULL     COMMENT '退机时间',
  `reward_points`      BIGINT          NOT NULL DEFAULT 100 COMMENT '安装积分（装机确认时冻结记账，达标转可用；快照）',
  `status`             TINYINT         NOT NULL DEFAULT 1 COMMENT '审核状态: 1待审核 2已通过 3已驳回 4已过期 5已撤销',
  `reject_reason`      VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '驳回原因',
  `reviewer_id`        BIGINT UNSIGNED NULL     COMMENT '审核人（admin_user.id）',
  `reviewed_at`        DATETIME        NULL     COMMENT '审核时间',
  `reward_issued_at`   DATETIME        NULL     COMMENT '安装积分记账时间（幂等标记）',
  `submit_count`       INT             NOT NULL DEFAULT 1 COMMENT '提交次数（驳回后重新提交）',
  `created_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '申请时间',
  `updated_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sn` (`sn`),
  KEY `idx_user_status` (`user_id`, `status`),
  KEY `idx_status_due` (`status`, `due_at`) COMMENT '25天到期扫描（未达标处理）',
  KEY `idx_last_trade` (`last_trade_at`) COMMENT '再入队运营校验（近30天有交易）'
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = 'POS机安装与达标监控（v2.0 FR-3.x 全字段）';

-- =====================================================================
-- 四、积分钱包域（FR-4.x）
-- =====================================================================

-- 4.1 积分钱包（全系统唯一钱包；积分不可提现为硬约束，无提现通道字段）
CREATE TABLE `point_wallet` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id`           BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `balance`           BIGINT          NOT NULL DEFAULT 0 COMMENT '可用余额（积分）',
  `frozen_balance`    BIGINT          NOT NULL DEFAULT 0 COMMENT '冻结积分（安装积分达标前冻结/风控/分润池保护，FR-4.3）',
  `total_earned`      BIGINT          NOT NULL DEFAULT 0 COMMENT '累计收入（只增，对账用）',
  `total_consumed`    BIGINT          NOT NULL DEFAULT 0 COMMENT '累计消费（只增，对账用）',
  `version`           INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '乐观锁版本号（并发扣减/入账）',
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user` (`user_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '积分钱包（FR-4.1 强一致记账主体）';

-- 4.2 积分流水（只增不改；flow_no 幂等键 = 事件ID+奖励类型+受益人，FR-9.7）
CREATE TABLE `point_flow` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `flow_no`        VARCHAR(64)     NOT NULL COMMENT '流水号（幂等键：业务前缀+事件ID，如 QU{sn}/RF{event}{level}{uid}/DV{room}{round}/TS{task}/GF{gift}/OF{order}/EX{batch}/AD{admin}）',
  `user_id`        BIGINT UNSIGNED NOT NULL COMMENT '受益用户ID',
  `delta`          BIGINT          NOT NULL COMMENT '变动值（正=入账 负=出账）',
  `balance_after`  BIGINT          NOT NULL COMMENT '变动后余额（对账锚点）',
  `flow_type`      VARCHAR(32)     NOT NULL COMMENT '类型: INSTALL安装(冻结) INSTALL_UNFREEZE达标转可用 QUALIFIED达标入队 REFERRAL_L1/L2/L3推荐达标 DIVIDEND团队分红 DIVIDEND_REF_L1/L2/L3分红联动 TASK任务 GIFT_ACTIVITY活动赠送 GIFT_RULE规则赠送 GIFT_PEER互赠 MALL_CONSUME商城核销 MALL_REFUND退货回补 EXPIRE过期清零 RECYCLE未达标回收 ADJUST后台调账',
  `biz_id`         BIGINT UNSIGNED NULL     COMMENT '关联业务ID（机器ID/团队ID/任务实例ID/赠送ID/订单ID…）',
  `biz_no`         VARCHAR(64)     NOT NULL DEFAULT '' COMMENT '关联业务单号（机器SN/订单号等，冗余便于排查）',
  `rule_version`   INT             NOT NULL DEFAULT 1 COMMENT '结算规则版本快照（FR-9.1 新事件用新版本，历史不受影响）',
  `expire_at`      DATETIME        NULL     COMMENT '本批积分过期时间（获得+12个月，FR-4.4）',
  `deferred_flag`  TINYINT         NOT NULL DEFAULT 0 COMMENT '分润池保护顺延标记: 0否 1是（池恢复后补发，FR-9.12）',
  `frozen`         TINYINT         NOT NULL DEFAULT 0 COMMENT '是否冻结态: 1冻结(未满足条件) 0可用',
  `remark`         VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '备注（计算过程/等级系数说明）',
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '入账时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_flow_no` (`flow_no`),
  KEY `idx_user_time` (`user_id`, `created_at`),
  KEY `idx_type_biz` (`flow_type`, `biz_id`),
  KEY `idx_expire` (`expire_at`, `frozen`) COMMENT '每日过期清零扫描'
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '积分流水（只增，v2.0 全来源类型+规则版本+顺延标记）';

-- 4.3 积分有效期批次（FR-4.4：12个月过期，任务/赠送积分可单独设有效期）
--     按 (user_id, 来源批次) 记账，每日过期 Job 按批次清零
CREATE TABLE `point_expire_batch` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id`        BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `source_batch_no` VARCHAR(64)    NOT NULL COMMENT '来源批次号（=产生该批积分的 flow_no 或活动批次）',
  `points`         BIGINT          NOT NULL COMMENT '该批次有效积分数（核销/过期时递减）',
  `expire_at`      DATETIME        NOT NULL COMMENT '过期时间（获得时间 + 有效期月数）',
  `status`         TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1有效 2已清零',
  `cleared_at`     DATETIME        NULL     COMMENT '清零时间',
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_expire` (`user_id`, `expire_at`),
  KEY `idx_expire_status` (`status`, `expire_at`) COMMENT '每日过期扫描'
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '积分有效期批次（FR-4.4 12个月过期）';

-- =====================================================================
-- 五、团队树 / 7 人房间域（FR-10.x / FR-9.8~9.10）
-- =====================================================================

-- 5.1 入队名额（v2.0 新增：替代 v1.0 缴费订单，FR-3.4/FR-3.8）
CREATE TABLE `team_slot` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '名额ID',
  `user_id`       BIGINT UNSIGNED NOT NULL COMMENT '持有用户ID',
  `pos_task_id`   BIGINT UNSIGNED NOT NULL COMMENT '关联机器ID（1台达标机器=1个名额；多机不新增名额 FR-3.5）',
  `pos_sn`        VARCHAR(64)     NOT NULL COMMENT '机器SN（冗余）',
  `granted_at`    DATETIME        NOT NULL COMMENT '授予时间（达标时刻）',
  `status`        TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1待入队 2在队 3已离队(中奖再入队中) 4等待队列 5已失效(未达标回收)',
  `room_id`       BIGINT UNSIGNED NULL     COMMENT '当前所在房间ID',
  `pos_no`        TINYINT         NULL     COMMENT '当前位置 1~7',
  `joined_at`     DATETIME        NULL     COMMENT '入队时间',
  `left_at`       DATETIME        NULL     COMMENT '离队时间（中奖）',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user` (`user_id`) COMMENT '1人1名额（FR-3.5 首台达标才授予）',
  KEY `idx_status` (`status`),
  KEY `idx_room` (`room_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '入队名额（v2.0 达标免费获取，1人1名额）';

-- 5.2 房间（7 人分红单元 = 1队长 + 2直推 + 4间推）
CREATE TABLE `room` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '房间ID',
  `captain_user_id` BIGINT UNSIGNED NULL     COMMENT '队长ID（位置1占用者，冗余）',
  `status`          TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1补位中 2已满员待结算 3已分红已重组(归档)',
  `round_no`        INT             NOT NULL DEFAULT 0 COMMENT '该房间已完成分红轮次（归档房间保留）',
  `last_dividend_at` DATETIME       NULL     COMMENT '最近分红时间',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '7人房间（分红判定单元，FR-10.1）';

-- 5.3 房间位置（固定 7 位；pos_no 即入位顺序：从上到下、从左到右）
CREATE TABLE `room_position` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `room_id`        BIGINT UNSIGNED NOT NULL COMMENT '房间ID',
  `pos_no`         TINYINT         NOT NULL COMMENT '位置序号 1~7（1=队长，2~3=直推，4~7=间推）',
  `row_no`         TINYINT         NOT NULL COMMENT '排号（冗余，展示用，1+2+4 布局）',
  `col_no`         TINYINT         NOT NULL COMMENT '列号（冗余，展示用）',
  `holder_user_id` BIGINT UNSIGNED NULL     COMMENT '当前占用用户ID（NULL=空位）',
  `contrib_points` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '该用户在此位置的贡献值（0~2，FR-9.8）',
  `occupied_at`    DATETIME        NULL     COMMENT '入位时间（权重"位置"排序依据：越早越好）',
  `vacated_at`     DATETIME        NULL     COMMENT '离开时间（中奖离队/重组）',
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_room_pos` (`room_id`, `pos_no`),
  KEY `idx_room_holder` (`room_id`, `holder_user_id`),
  KEY `idx_holder` (`holder_user_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '房间位置（7位固定，FR-10.2 补位顺序基准）';

-- 5.4 贡献值明细（事件流；权重计算主依据，FR-9.8）
CREATE TABLE `contribution_record` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id`       BIGINT UNSIGNED NOT NULL COMMENT '贡献值归属用户',
  `room_id`       BIGINT UNSIGNED NOT NULL COMMENT '所在房间',
  `pos_no`        TINYINT         NOT NULL COMMENT '所在位置（1~7）',
  `source_type`   VARCHAR(32)     NOT NULL COMMENT '来源: REFERRAL达标推荐人(每推荐1人+1,上限2) DOWN_REACH下线达标 REBUILD_TRANSFER重组结转',
  `source_biz_id` BIGINT UNSIGNED NULL     COMMENT '来源业务ID（达标事件/重组记录）',
  `is_overflow`   TINYINT         NOT NULL DEFAULT 0 COMMENT '第3人"顺延给下一次"承接标记（Q11 口径）: 0否 1是',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '获得时间（权重次排序：先后）',
  PRIMARY KEY (`id`),
  KEY `idx_user_room` (`user_id`, `room_id`),
  KEY `idx_room_time` (`room_id`, `created_at`) COMMENT '权重排序：贡献值优先+获取先后'
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '贡献值明细（只增，FR-9.8 权重主依据）';

-- 5.5 分红记录（一轮分红 = 一条；round_no 支持无限次循环，FR-9.5/FR-10.4）
CREATE TABLE `dividend_record` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '分红记录ID',
  `room_id`             BIGINT UNSIGNED NOT NULL COMMENT '房间ID',
  `round_no`            INT             NOT NULL COMMENT '分红轮次（该房间内第N轮，1开始）',
  `winner_user_id`      BIGINT UNSIGNED NOT NULL COMMENT '中奖用户（权重最高者）',
  `dividend_points`     BIGINT          NOT NULL DEFAULT 1200 COMMENT '分红积分（默认1200/次，规则版本快照）',
  `winner_weight`       JSON            NOT NULL COMMENT '中奖人权重快照 {contrib_points, pos_no, occupied_at, seq}',
  `full_weight_order`   JSON            NULL     COMMENT '满员7人完整权重排序快照（审计/申诉）',
  `rule_version`        INT             NOT NULL DEFAULT 1 COMMENT '结算规则版本',
  `reentry_id`          BIGINT UNSIGNED NULL     COMMENT '中奖者再入队记录ID（team_reentry.id，回填）',
  `deferred_flag`       TINYINT         NOT NULL DEFAULT 0 COMMENT '分润池保护顺延: 0已发放 1延迟待补发（FR-9.12）',
  `settled_at`          DATETIME        NOT NULL COMMENT '结算时间',
  `created_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_room_round` (`room_id`, `round_no`) COMMENT '同一房间同一轮次只结算一次（幂等）',
  KEY `idx_winner` (`winner_user_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '团队分红记录（FR-9.5 1200积分/轮，无限循环）';

-- 5.6 再入队记录（v2.0 核心：替代"自动重下单"，FR-9.9/FR-10.6）
CREATE TABLE `team_reentry` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '再入队记录ID',
  `user_id`         BIGINT UNSIGNED NOT NULL COMMENT '再入队用户（中奖者）',
  `dividend_id`     BIGINT UNSIGNED NOT NULL COMMENT '触发来源分红记录ID',
  `from_room_id`    BIGINT UNSIGNED NOT NULL COMMENT '离队房间ID',
  `target_referrer_id` BIGINT UNSIGNED NULL  COMMENT '目标推荐人ID（以其队伍为再入队目标，FR-9.9）',
  `to_room_id`      BIGINT UNSIGNED NULL     COMMENT '实际入队房间ID（空位产生后回填）',
  `to_pos_no`       TINYINT         NULL     COMMENT '实际入队位置',
  `round_no`        INT             NOT NULL COMMENT '该用户第N次再入队（无限次，留痕）',
  `machine_check`   TINYINT         NOT NULL DEFAULT 1 COMMENT '机器持续运营校验: 1通过(未退机+近30天有交易) 0未通过(暂停)',
  `machine_sn`      VARCHAR(64)     NOT NULL COMMENT '校验用机器SN',
  `status`          TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1等待队列 2已再入队 3资格暂停(运营校验未过) 4已失效',
  `enqueued_at`     DATETIME        NOT NULL COMMENT '进入再入队队列时间（等待队列按此排序，FR-10.6）',
  `rejoined_at`     DATETIME        NULL     COMMENT '实际再入队时间',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dividend` (`dividend_id`) COMMENT '一次分红只产生一条再入队（幂等）',
  KEY `idx_user` (`user_id`),
  KEY `idx_status_queue` (`status`, `enqueued_at`) COMMENT '等待队列按时间自动补位扫描'
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '再入队记录（v2.0 免费自动再入队，FR-9.9）';

-- 5.7 房间重组记录（FR-9.10/FR-10.5：6人按权重重排 → 新房间结构）
CREATE TABLE `room_rebuild` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `dividend_id`  BIGINT UNSIGNED NOT NULL COMMENT '触发来源分红记录ID',
  `old_room_id`  BIGINT UNSIGNED NOT NULL COMMENT '原房间ID',
  `round_no`     INT             NOT NULL COMMENT '对应分红轮次',
  `new_room_id`  BIGINT UNSIGNED NOT NULL COMMENT '重组后新房间ID（v2.0 重组后仍为 7 人结构：1+2+4，待补位）',
  `weight_order` JSON            NOT NULL COMMENT '6人权重排序快照 [{user_id,contrib_points,pos_no,occupied_at,rank}]（Q12 结构定稿后只改算法）',
  `rebuilt_at`   DATETIME        NOT NULL COMMENT '重组时间',
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dividend` (`dividend_id`) COMMENT '一次分红只重组一次（幂等）'
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '房间重组记录（FR-9.10，权重快照留痕）';

-- 5.8 房间操作日志（只增，FR-10.x 全操作可追溯）
CREATE TABLE `room_op_log` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `room_id`     BIGINT UNSIGNED NOT NULL COMMENT '房间ID',
  `op_type`     VARCHAR(32)     NOT NULL COMMENT '操作: OCCUPY入位 REENTER再入队 DIVIDEND分红 REBUILD重组 VACATE离队 WAIT_ENQUEUE等待入队',
  `user_id`     BIGINT UNSIGNED NULL     COMMENT '涉及用户',
  `pos_no`      TINYINT         NULL     COMMENT '涉及位置',
  `round_no`    INT             NOT NULL DEFAULT 0 COMMENT '关联分红轮次',
  `from_state`  JSON            NULL     COMMENT '操作前状态快照',
  `to_state`    JSON            NULL     COMMENT '操作后状态快照',
  `biz_no`      VARCHAR(64)     NOT NULL DEFAULT '' COMMENT '关联业务单号（幂等/追溯）',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (`id`),
  KEY `idx_room_time` (`room_id`, `created_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '房间操作日志（只增，全链路可追溯）';

-- =====================================================================
-- 六、积分商城域（FR-5.x，纯积分定价，唯一核销出口）
-- =====================================================================

-- 6.1 商户/店铺（单商户模式默认 1 条系统商户；多商户模式预留）
CREATE TABLE `merchant` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '商户ID',
  `name`        VARCHAR(64)     NOT NULL COMMENT '店铺名称',
  `logo`        VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '店铺Logo',
  `status`      TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1营业 0停业',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '商户/店铺（sys_config.mall_mode 控制单/多商户）';

-- 6.2 商品（FR-5.1 上架成本校验 / FR-5.2 等级专属池 / FR-5.8 库存预警）
CREATE TABLE `product` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '商品ID',
  `merchant_id`    BIGINT UNSIGNED NOT NULL COMMENT '所属商户ID',
  `name`           VARCHAR(128)    NOT NULL COMMENT '商品名称',
  `cover`          VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '封面图',
  `detail`         TEXT            NULL     COMMENT '商品详情（富文本/图片JSON）',
  `price_points`   BIGINT          NOT NULL COMMENT '纯积分价格（v2.0 无现金部分）',
  `cost_amount`    DECIMAL(12, 2)  NOT NULL DEFAULT 0 COMMENT '单件履约成本（元，采购+物流；上架校验: cost ≤ price_points × 成本系数）',
  `cost_over_limit` TINYINT        NOT NULL DEFAULT 0 COMMENT '超成本上架审批标记: 0否 1是（超限需审批，FR-5.1）',
  `stock`          INT             NOT NULL DEFAULT 0 COMMENT '库存（条件更新扣减防超卖）',
  `stock_warn`     INT             NOT NULL DEFAULT 10 COMMENT '库存预警阈值',
  `limit_per_user` INT             NULL     COMMENT '限购: 每人限购数量（NULL=不限）',
  `limit_period`   VARCHAR(8)      NOT NULL DEFAULT 'LIFETIME' COMMENT '限购周期: DAY/WEEK/MONTH/LIFETIME',
  `min_level`      TINYINT         NOT NULL DEFAULT 0 COMMENT '可兑最低等级: 0=L0体验池 1=L1 2=L2 3=L3（FR-5.2 等级池）',
  `delivery_type`  TINYINT         NOT NULL DEFAULT 1 COMMENT '发货方式: 1实物物流 2虚拟自动发放（FR-5.4）',
  `virtual_config` JSON            NULL     COMMENT '虚拟权益配置（权益方API/卡密池参数）',
  `status`         TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1上架 0下架',
  `online_at`      DATETIME        NULL     COMMENT '定时上架时间',
  `offline_at`     DATETIME        NULL     COMMENT '定时下架时间（活动商品，FR-5.8）',
  `sort`           INT             NOT NULL DEFAULT 0 COMMENT '排序',
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_merchant_status` (`merchant_id`, `status`),
  KEY `idx_min_level` (`min_level`, `status`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '商品（纯积分计价+成本校验+等级池，FR-5.x）';

-- 6.3 兑换订单（FR-5.3 冻结扣减 / FR-5.4 履约 / FR-5.5 售后 / FR-5.9 成本回传）
CREATE TABLE `mall_order` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '订单ID',
  `order_no`         VARCHAR(64)     NOT NULL COMMENT '订单号（OF 前缀）',
  `user_id`          BIGINT UNSIGNED NOT NULL COMMENT '兑换用户ID',
  `merchant_id`      BIGINT UNSIGNED NOT NULL COMMENT '商户ID（快照）',
  `product_id`       BIGINT UNSIGNED NOT NULL COMMENT '商品ID',
  `product_name`     VARCHAR(128)    NOT NULL COMMENT '商品名称快照',
  `product_price`    BIGINT          NOT NULL COMMENT '积分价格快照',
  `quantity`         INT             NOT NULL DEFAULT 1 COMMENT '数量',
  `total_points`     BIGINT          NOT NULL COMMENT '积分扣减总额',
  `address`          JSON            NULL     COMMENT '收货地址快照 {name,phone,province,city,detail}（实物）',
  `track_no`         VARCHAR(64)     NOT NULL DEFAULT '' COMMENT '物流单号（实物，FR-5.4）',
  `virtual_result`   JSON            NULL     COMMENT '虚拟发放结果 {code, account, retry_count}（失败自动重试/补发）',
  `fulfill_cost`     DECIMAL(12, 2)  NULL     COMMENT '实际履约成本（元，日终按采购价对账修正，FR-5.9）',
  `pool_reported`    TINYINT         NOT NULL DEFAULT 0 COMMENT '履约成本是否已回传分润池: 0否 1是（幂等）',
  `status`           TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1积分已冻结 2兑换成功(待履约) 3已发货 4已完成 5已取消(积分已释放) 6退款中 7已退款(积分原路退回) 8虚拟发放失败(补发中)',
  `after_sale_type`  TINYINT         NOT NULL DEFAULT 0 COMMENT '售后: 0无 1实物退货 2虚拟作废补发（FR-5.5）',
  `after_sale_at`    DATETIME        NULL     COMMENT '售后发起时间',
  `paid_at`          DATETIME        NULL     COMMENT '积分扣减成功时间',
  `finished_at`      DATETIME        NULL     COMMENT '终态时间',
  `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_user_status` (`user_id`, `status`),
  KEY `idx_status_pool` (`status`, `pool_reported`) COMMENT '履约成本回传分润池扫描'
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '兑换订单（纯积分核销，FR-5.x）';

-- =====================================================================
-- 七、任务域（FR-7.x，v2.0 事件驱动+配置化，替代 v1.0 自主领取）
-- =====================================================================

-- 7.1 任务模板（后台配置化：新手包/普通周期/成就，FR-7.5）
CREATE TABLE `task_template` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '任务ID',
  `code`            VARCHAR(32)     NOT NULL COMMENT '任务编码（如 T_N3/T_D1/T_M1/T_A1）',
  `name`            VARCHAR(64)     NOT NULL COMMENT '任务名称',
  `task_type`       TINYINT         NOT NULL COMMENT '类型: 1新手(30天限时) 2普通-周期(日/周/月) 3普通-成就(单次)',
  `event_type`      VARCHAR(32)     NOT NULL COMMENT '完成条件事件: REGISTER/INSTALL/QUALIFIED/REFERRAL_REG/REFERRAL_QUALIFIED/TEAM_JOIN/SIGN_IN/PROMO_ACTION/MONTH_FLOW/TEAM_DIVIDEND',
  `threshold`       INT             NOT NULL DEFAULT 1 COMMENT '阈值（次数/金额，事件口径）',
  `period`          VARCHAR(8)      NOT NULL DEFAULT 'LIFETIME' COMMENT '周期: DAY/WEEK/MONTH/LIFETIME（周期任务到期重置）',
  `period_key_fmt`  VARCHAR(32)     NOT NULL DEFAULT '' COMMENT '周期标识格式（如 YYYYMMDD，实例幂等键组成）',
  `reward_points`   BIGINT          NOT NULL COMMENT '奖励积分（FR-7.5 可配）',
  `min_level`       TINYINT         NOT NULL DEFAULT 0 COMMENT '适用最低等级（L0/L1+，FR-7.5 适用人群）',
  `max_per_user`    INT             NOT NULL DEFAULT 1 COMMENT '每人可完成次数（周期任务=每周期1次）',
  `expire_days`     INT             NULL     COMMENT '有效期（新手任务=注册后30天，FR-7.2）',
  `quota`           INT             NULL     COMMENT '名额限制（NULL=不限）',
  `effective_from`  DATETIME        NULL     COMMENT '生效开始时间',
  `effective_to`    DATETIME        NULL     COMMENT '生效结束时间',
  `sort`            INT             NOT NULL DEFAULT 0 COMMENT '排序',
  `status`          TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1启用 0停用',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '任务模板（后台配置化，FR-7.5）';

-- 7.2 用户任务实例（事件驱动判定，幂等防重复领奖，FR-7.3）
CREATE TABLE `user_task` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '实例ID',
  `user_id`       BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `task_id`       BIGINT UNSIGNED NOT NULL COMMENT '任务模板ID',
  `period_key`    VARCHAR(32)     NOT NULL DEFAULT '' COMMENT '周期标识（日=YYYYMMDD 周=YYYYWW 月=YYYYMM；单次/新手为空）',
  `progress`      INT             NOT NULL DEFAULT 0 COMMENT '当前进度（事件累计计数/金额）',
  `due_at`        DATETIME        NULL     COMMENT '到期时间（新手任务=注册+30天，到期自动关闭 FR-7.2）',
  `status`        TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1进行中 2已完成待发奖 3已发奖 4已过期关闭 5已冻结(风控 FR-7.6)',
  `completed_at`  DATETIME        NULL     COMMENT '完成时间',
  `settled_at`    DATETIME        NULL     COMMENT '奖励发放时间（幂等标记）',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_task_period` (`user_id`, `task_id`, `period_key`) COMMENT '同一用户同一任务同一周期仅一条（幂等 FR-7.6）',
  KEY `idx_status_due` (`status`, `due_at`) COMMENT '新手任务到期扫描',
  KEY `idx_settle` (`status`, `completed_at`) COMMENT '发奖结算扫描'
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '用户任务实例（FR-7.3 事件驱动+幂等）';

-- =====================================================================
-- 八、积分赠送域（FR-8.x）
-- =====================================================================

-- 8.1 赠送活动（FR-8.1 预算硬控/双人审批）
CREATE TABLE `gift_activity` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '活动ID',
  `name`            VARCHAR(64)     NOT NULL COMMENT '活动名称',
  `target_rule`     JSON            NOT NULL COMMENT '目标人群规则 {level:[], reg_from, reg_to, tags:[]}',
  `points_per_user` BIGINT          NOT NULL COMMENT '每人赠送积分',
  `budget_points`   BIGINT          NOT NULL COMMENT '预算上限（积分）',
  `budget_amount`   DECIMAL(12, 2)  NOT NULL COMMENT '预算上限（元，= 积分 × 成本系数 折算）',
  `issued_points`   BIGINT          NOT NULL DEFAULT 0 COMMENT '已发放积分（超预算自动停止，FR-8.4）',
  `issued_count`    INT             NOT NULL DEFAULT 0 COMMENT '已发放人数',
  `points_expire_days` INT          NOT NULL DEFAULT 120 COMMENT '赠送积分有效期（天，可单独设置）',
  `status`          TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1待审批 2审批通过执行中 3已完成 4已停止(超预算) 5已驳回 6冻结(分润池保护 FR-9.12)',
  `approver_id`     BIGINT UNSIGNED NULL     COMMENT '审批人1（双人复核）',
  `approver2_id`    BIGINT UNSIGNED NULL     COMMENT '审批人2（大额活动双人审批 FR-8.4）',
  `effective_from`  DATETIME        NOT NULL COMMENT '生效开始',
  `effective_to`    DATETIME        NOT NULL COMMENT '生效结束',
  `created_by`      BIGINT UNSIGNED NOT NULL COMMENT '创建人（admin_user.id）',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '赠送活动（FR-8.1 预算硬控）';

-- 8.2 赠送记录（台账，只增；FR-8.2 规则赠送 / FR-8.3 互赠 / FR-8.5）
CREATE TABLE `gift_record` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  `gift_type`     TINYINT         NOT NULL COMMENT '类型: 1活动赠送 2规则赠送(生日/周年/晋级礼/达标欢迎礼) 3会员互赠',
  `activity_id`   BIGINT UNSIGNED NULL     COMMENT '活动ID（类型1时必填）',
  `from_user_id`  BIGINT UNSIGNED NULL     COMMENT '发起用户（互赠必填；规则赠送为空）',
  `to_user_id`    BIGINT UNSIGNED NOT NULL COMMENT '接收用户',
  `points`        BIGINT          NOT NULL COMMENT '赠送积分',
  `confirm_deadline` DATETIME     NULL     COMMENT '互赠确认截止时间（24h，超时退回 FR-8.3）',
  `confirmed_at`  DATETIME        NULL     COMMENT '接收确认时间',
  `flow_no`       VARCHAR(64)     NOT NULL COMMENT '到账流水号（point_flow.flow_no，幂等）',
  `status`        TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1待确认(互赠) 2已到账 3已退回(超时/拒绝) 4已拦截(风控)',
  `risk_block_reason` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '风控拦截原因（高频互赠/冻结账户 FR-8.4）',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_flow_no` (`flow_no`),
  KEY `idx_to_user` (`to_user_id`, `status`),
  KEY `idx_activity` (`activity_id`),
  KEY `idx_confirm` (`status`, `confirm_deadline`) COMMENT '互赠24h超时退回扫描'
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '赠送记录台账（只增，FR-8.5）';

-- =====================================================================
-- 九、分润池域（v2.0 平台造血核心，§2.5 / FR-12.9）
-- =====================================================================

-- 9.1 分润池参数（后台配置，变更双人复核+审计）
CREATE TABLE `profit_pool_config` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `pool_name`          VARCHAR(64)     NOT NULL DEFAULT 'MAIN' COMMENT '池标识（当前单池 MAIN，预留多池）',
  `fee_rate_protocol`  DECIMAL(6, 4)   NOT NULL DEFAULT 0.0060 COMMENT '收单协议综合费率（默认0.6%，Q13 待确认）',
  `channel_cost_rate`  DECIMAL(6, 4)   NOT NULL DEFAULT 0.0030 COMMENT '通道成本率（净收益 = (协议-成本) × 流水）',
  `deposit_ratio`      DECIMAL(5, 4)   NOT NULL DEFAULT 1.0000 COMMENT '手续费净收益划入比例（默认100%）',
  `point_cost_factor`  DECIMAL(6, 4)   NOT NULL DEFAULT 0.3000 COMMENT '积分成本系数（元/积分，默认0.3）',
  `redeem_rate`        DECIMAL(5, 4)   NOT NULL DEFAULT 0.6500 COMMENT '预估核销率（测算参数，默认65%）',
  `warn_days`          INT             NOT NULL DEFAULT 30 COMMENT '告警阈值（天，余额 < N天预计支出 → 告警）',
  `guard_days`         INT             NOT NULL DEFAULT 14 COMMENT '保护阈值（天，余额 < M天 → 降级执行）',
  `downgrade_order`    JSON            NOT NULL COMMENT '降级策略顺序（可配置）: ["DIVIDEND_DEFER","TASK_HALF","GIFT_FREEZE","REFERRAL_NORMAL"]',
  `guard_status`       TINYINT         NOT NULL DEFAULT 0 COMMENT '当前保护状态: 0正常 1告警 2降级中（结算引擎前置检查读取）',
  `guard_since`        DATETIME        NULL     COMMENT '进入当前状态时间',
  `version`            INT             NOT NULL DEFAULT 1 COMMENT '参数版本（审计）',
  `updated_by`         BIGINT UNSIGNED NULL     COMMENT '最后修改人',
  `created_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '分润池参数（FR-12.9 配置化+保护状态）';

-- 9.2 分润池台账（日粒度+事件粒度，只增；FR-12.9 台账/审计）
CREATE TABLE `profit_pool_ledger` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `biz_date`      DATE            NOT NULL COMMENT '业务日期（T+1 记账日）',
  `ledger_type`   VARCHAR(32)     NOT NULL COMMENT '类型: IN入池(手续费净收益) LIABILITY_ADD发放负债计提 LIABILITY_REVERSE核销冲减负债 OUT履约成本出池 GUARD_DEFER分红顺延挂账 GUARD_RECOVER顺延补发 ADJUST调账',
  `amount`        DECIMAL(14, 2)  NOT NULL COMMENT '金额（元，IN/OUT正负按方向；LIABILITY 存计提额）',
  `points`        BIGINT          NOT NULL DEFAULT 0 COMMENT '关联积分量（LIABILITY = 积分 × 成本系数 折算）',
  `source_type`   VARCHAR(32)     NOT NULL DEFAULT '' COMMENT '来源: ACQ_SETTLE收单结算 / FLOW发放事件 / ORDER履约 / MANUAL人工',
  `source_biz_id` BIGINT UNSIGNED NULL     COMMENT '来源ID（结算批次ID/flow_id/订单ID）',
  `balance_after` DECIMAL(14, 2)  NOT NULL COMMENT '记账后池余额（对账锚点）',
  `remark`        VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '备注',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记账时间',
  PRIMARY KEY (`id`),
  KEY `idx_date` (`biz_date`),
  KEY `idx_type_time` (`ledger_type`, `created_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '分润池台账（只增，FR-12.9 全链路可审计）';

-- 9.3 分润池每日汇总（FR-11.3 健康度报表：可支撑天数/核销率）
CREATE TABLE `profit_pool_daily` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `biz_date`         DATE            NOT NULL COMMENT '统计日期',
  `opening_balance`  DECIMAL(14, 2)  NOT NULL COMMENT '期初余额',
  `in_amount`        DECIMAL(14, 2)  NOT NULL DEFAULT 0 COMMENT '当日入池（手续费净收益）',
  `machine_count`    INT             NOT NULL DEFAULT 0 COMMENT '入池机器数（按机器归集）',
  `liability_add`    DECIMAL(14, 2)  NOT NULL DEFAULT 0 COMMENT '当日发放负债计提',
  `out_amount`       DECIMAL(14, 2)  NOT NULL DEFAULT 0 COMMENT '当日履约成本出池',
  `closing_balance`  DECIMAL(14, 2)  NOT NULL COMMENT '期末余额',
  `pending_liability` DECIMAL(14, 2) NOT NULL DEFAULT 0 COMMENT '预计负债（未核销积分 × 成本系数 × 核销率）',
  `avg_daily_spend`  DECIMAL(14, 2)  NOT NULL DEFAULT 0 COMMENT '日均支出（近30天，可支撑天数分母）',
  `support_days`     INT             NOT NULL DEFAULT 0 COMMENT '可支撑天数 = 余额 / 日均支出',
  `redeem_rate_actual` DECIMAL(5, 4) NOT NULL DEFAULT 0 COMMENT '实际核销率（近30天）',
  `guard_status`     TINYINT         NOT NULL DEFAULT 0 COMMENT '当日保护状态: 0正常 1告警 2降级',
  `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '生成时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_date` (`biz_date`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '分润池每日汇总（FR-11.3 健康度报表）';

-- =====================================================================
-- 十、收单结算域（B端对公，§6 接口需求；达标判定与入池的唯一数据源）
-- =====================================================================

-- 10.1 收单结算批次（T+1 对账单文件/API 归集）
CREATE TABLE `acq_settle_batch` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '批次ID',
  `batch_no`      VARCHAR(64)     NOT NULL COMMENT '机构结算单号',
  `settle_date`   DATE            NOT NULL COMMENT '结算日期（T+1 记账日）',
  `total_flow`    DECIMAL(14, 2)  NOT NULL DEFAULT 0 COMMENT '交易流水总额',
  `total_fee`     DECIMAL(14, 2)  NOT NULL DEFAULT 0 COMMENT '手续费总额',
  `net_revenue`   DECIMAL(14, 2)  NOT NULL DEFAULT 0 COMMENT '手续费净收益（= 流水 × (协议费率-通道成本率)）',
  `deposit_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0 COMMENT '划入分润池金额（净收益 × 划入比例）',
  `machine_count` INT             NOT NULL DEFAULT 0 COMMENT '归集机器数',
  `reconciled`    TINYINT         NOT NULL DEFAULT 0 COMMENT '对账状态: 0待对账 1一致 2差异(工单)（FR-12.6）',
  `status`        TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1已导入 2已入账 3已作废',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '导入时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_batch_no` (`batch_no`),
  UNIQUE KEY `uk_settle_date` (`settle_date`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '收单结算批次（T+1 B端对公，入池依据）';

-- 10.2 收单结算明细（按机器归集；虚假流水以机构风控标记为准，风险3对策）
CREATE TABLE `acq_settle_item` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `batch_id`       BIGINT UNSIGNED NOT NULL COMMENT '结算批次ID',
  `pos_task_id`    BIGINT UNSIGNED NOT NULL COMMENT '机器ID',
  `flow_amount`    DECIMAL(12, 2)  NOT NULL COMMENT '当日交易流水',
  `fee_amount`     DECIMAL(12, 2)  NOT NULL COMMENT '当日手续费',
  `fake_flag`      TINYINT         NOT NULL DEFAULT 0 COMMENT '机构风控标记: 0真实 1疑似虚假（不计达标/不入池，以机构为准）',
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_batch_pos` (`batch_id`, `pos_task_id`),
  KEY `idx_pos` (`pos_task_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '收单结算明细（按机器归集）';

-- =====================================================================
-- 十一、风控域（FR-6.5 / FR-12.7）
-- =====================================================================

CREATE TABLE `risk_record` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id`       BIGINT UNSIGNED NOT NULL COMMENT '命中用户',
  `risk_type`     VARCHAR(32)     NOT NULL COMMENT '风险类型: MULTI_ACCOUNT多账号 FAKE_FLOW虚假流水刷达标 CASH_OUT套现高频兑换 HIGH_GIFT高频互赠 SELF_RECOMMEND自推 BATCH_TASK脚本刷任务',
  `evidence`      JSON            NULL     COMMENT '证据快照（设备指纹/IP/交易结构/关联账号）',
  `action`        TINYINT         NOT NULL DEFAULT 1 COMMENT '处置: 1仅告警 2冻结积分 3拦截事件 4封禁账户',
  `action_detail` VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '处置说明（冻结积分量/拦截事件ID）',
  `status`        TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1待审核 2已确认处置 3误报解除',
  `operator_id`   BIGINT UNSIGNED NULL     COMMENT '处理人（admin_user.id）',
  `handled_at`    DATETIME        NULL     COMMENT '处理时间',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '命中时间',
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`, `status`),
  KEY `idx_type` (`risk_type`, `status`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '风控记录（FR-12.7 拦截留痕+人工审核）';

-- =====================================================================
-- 十二、工程辅助域（死信/对账）
-- =====================================================================

-- 12.1 死信队列（结算事件重试失败落库，人工/自动重放，FR-9.11）
CREATE TABLE `dead_letter` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `event_type`  VARCHAR(64)     NOT NULL COMMENT '事件类型（evt:pos.qualified 等）',
  `payload`     JSON            NOT NULL COMMENT '事件负载快照',
  `idem_key`    VARCHAR(128)    NOT NULL COMMENT '幂等键（重放去重）',
  `retry_count` INT             NOT NULL DEFAULT 0 COMMENT '已重试次数',
  `last_error`  VARCHAR(512)    NOT NULL DEFAULT '' COMMENT '最后错误信息',
  `status`      TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1待处理 2已重放成功 3已作废(人工)',
  `replayed_at` DATETIME        NULL     COMMENT '重放成功时间',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '入队时间',
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`, `created_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '结算死信队列（FR-9.11 失败兜底）';

-- 12.2 对账差异（FR-12.6 日终三口径：钱包↔流水 / 房间↔日志 / 分润池↔结算单）
CREATE TABLE `reconcile_diff` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `biz_date`    DATE            NOT NULL COMMENT '对账日期',
  `diff_type`   VARCHAR(32)     NOT NULL COMMENT '口径: WALLET_FLOW钱包与流水 ROOM_LOG房间与日志 POOL_SETTLE分润池与结算单',
  `ref_id`      BIGINT UNSIGNED NULL     COMMENT '差异对象ID（user_id/room_id/batch_id）',
  `expected`    VARCHAR(128)    NOT NULL COMMENT '期望值',
  `actual`      VARCHAR(128)    NOT NULL COMMENT '实际值',
  `status`      TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1待处理 2已修复 3误报',
  `handled_by`  BIGINT UNSIGNED NULL     COMMENT '处理人',
  `handled_at`  DATETIME        NULL     COMMENT '处理时间',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发现时间',
  PRIMARY KEY (`id`),
  KEY `idx_date_type` (`biz_date`, `diff_type`, `status`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '对账差异表（FR-12.6 日终对账兜底）';

-- =====================================================================
-- 十三、后台配置与权限域（FR-12.x / FR-601/602/805 / RBAC）
-- =====================================================================

-- 13.1 首页广告位
CREATE TABLE `ad_slot` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `name`        VARCHAR(64)     NOT NULL COMMENT '广告位名称',
  `image`       VARCHAR(255)    NOT NULL COMMENT '广告图片',
  `link_type`   VARCHAR(32)     NOT NULL DEFAULT '' COMMENT '跳转类型: H5/APP内页',
  `link_value`  VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '跳转值',
  `sort`        INT             NOT NULL DEFAULT 0 COMMENT '排序',
  `status`      TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1投放中 0已下线',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '首页广告位';

-- 13.2 系统配置（全局开关 + 分润池规则外的全局参数）
CREATE TABLE `sys_config` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `config_key`   VARCHAR(64)     NOT NULL COMMENT '配置键',
  `config_value` VARCHAR(512)    NOT NULL COMMENT '配置值',
  `remark`       VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '说明',
  `updated_by`   BIGINT UNSIGNED NULL     COMMENT '最后修改人（admin_user.id）',
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_key` (`config_key`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '系统全局配置（mall_mode/reach_days/reach_amount/point_expire_months 等）';

-- 13.3 后台账号（RBAC 三角色）
CREATE TABLE `admin_user` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '后台账号ID',
  `username`      VARCHAR(64)     NOT NULL COMMENT '登录名',
  `password_hash` VARCHAR(128)    NOT NULL COMMENT '密码哈希',
  `role`          VARCHAR(32)     NOT NULL DEFAULT 'OPERATOR' COMMENT '角色: SUPER_ADMIN/OPERATOR运营/AGENT代理',
  `status`        TINYINT         NOT NULL DEFAULT 1 COMMENT '状态: 1启用 0禁用',
  `last_login_at` DATETIME        NULL     COMMENT '最后登录时间',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '后台账号（FR-12.8 RBAC）';

CREATE TABLE `admin_permission` (
  `id`      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code`    VARCHAR(64)     NOT NULL COMMENT '权限编码（如 points:adjust、pool:config、gift:approve）',
  `name`    VARCHAR(64)     NOT NULL COMMENT '权限名称',
  `module`  VARCHAR(32)     NOT NULL COMMENT '所属模块',
  `sensitive` TINYINT       NOT NULL DEFAULT 0 COMMENT '敏感操作（需双人复核）: 0否 1是',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '后台权限点（敏感操作双人复核）';

CREATE TABLE `admin_role_permission` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `role`          VARCHAR(32)     NOT NULL COMMENT '角色',
  `permission_id` BIGINT UNSIGNED NOT NULL COMMENT '权限ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_perm` (`role`, `permission_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '角色-权限映射';

-- 13.4 后台操作日志（只增；敏感操作二次确认留痕）
CREATE TABLE `admin_op_log` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `admin_id`     BIGINT UNSIGNED NOT NULL COMMENT '操作人',
  `action`       VARCHAR(64)     NOT NULL COMMENT '操作（如 points.adjust、tier.update、pool.config）',
  `target_type`  VARCHAR(32)     NOT NULL DEFAULT '' COMMENT '对象类型',
  `target_id`    BIGINT UNSIGNED NULL     COMMENT '对象ID',
  `before_data`  JSON            NULL     COMMENT '变更前快照（敏感操作必填）',
  `after_data`   JSON            NULL     COMMENT '变更后快照（敏感操作必填）',
  `confirm_flag` TINYINT         NOT NULL DEFAULT 0 COMMENT '双人复核: 0否 1是（敏感操作必须=1，FR-12.8）',
  `confirm_by`   BIGINT UNSIGNED NULL     COMMENT '复核人（confirm_flag=1 时必填）',
  `ip`           VARCHAR(64)     NOT NULL DEFAULT '' COMMENT '操作IP',
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (`id`),
  KEY `idx_admin_time` (`admin_id`, `created_at`),
  KEY `idx_target` (`target_type`, `target_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '后台操作日志（只增，敏感操作双人复核审计）';

-- =====================================================================
-- 十四、初始化数据（demo）
-- =====================================================================

-- 会员等级 L0~L3（默认值，FR-2.x 待业务方确认）
INSERT INTO `tier` (`level_no`, `name`, `reach_condition`, `reward_factor`, `mall_pool`, `tag_name`, `tag_color`) VALUES
(0, '普通用户', '{"note":"注册即得，未装机达标"}', 0.00, 'TRIAL',  'L0', '#999999'),
(1, '基础会员', '{"qualified_machine":1}', 1.00, 'NORMAL', 'L1', '#1677ff'),
(2, '高级会员', '{"reach_recommend":2,"cumulative_points":3000}', 1.50, 'L2',     'L2', '#722ed1'),
(3, '钻石会员', '{"reach_recommend":6,"cumulative_points":10000}', 2.00, 'L3',     'L3', '#faad14');

-- 系统配置
INSERT INTO `sys_config` (`config_key`, `config_value`, `remark`) VALUES
('mall_mode', 'single', '商城模式: single单商户/multi多商户'),
('reach_days', '25', '达标窗口天数（装机后N天）'),
('reach_amount', '1000', '达标金额（元，25天内累计交易）'),
('point_expire_months', '12', '积分有效期（月，FR-4.4 待确认）'),
('dividend_points', '1200', '团队分红积分/次（默认值，待确认）'),
('qualified_points', '300', '达标入队积分（默认值，待确认）'),
('install_points', '100', '安装积分/台（冻结态，默认值，待确认）'),
('reentry_window_days', '30', '再入队运营校验窗口（近N天有真实交易，FR-9.9 待确认）'),
('gift_peer_max_per_op', '100', '会员互赠单次上限（FR-8.3）'),
('gift_peer_max_per_day', '5', '会员互赠单日次数上限（FR-8.3）'),
('mall_daily_consume_limit', '5000', '单账号单日商城兑换上限（积分，FR-5.7 待确认）');

-- 系统商户
INSERT INTO `merchant` (`name`, `logo`) VALUES ('超级展业积分商城', '');

-- 分润池参数（默认值，Q13/Q26 待确认，FR-12.9）
INSERT INTO `profit_pool_config`
(`pool_name`, `fee_rate_protocol`, `channel_cost_rate`, `deposit_ratio`, `point_cost_factor`, `redeem_rate`, `warn_days`, `guard_days`, `downgrade_order`)
VALUES
('MAIN', 0.0060, 0.0030, 1.0000, 0.3000, 0.6500, 30, 14,
 '["DIVIDEND_DEFER","TASK_HALF","GIFT_FREEZE","REFERRAL_NORMAL"]');

-- 新手任务包 T-N1~T-N6（默认值，FR-3.7 待确认；注册即开启30天，无需领取）
INSERT INTO `task_template` (`code`, `name`, `task_type`, `event_type`, `threshold`, `period`, `reward_points`, `min_level`, `max_per_user`, `expire_days`, `sort`) VALUES
('T_N1', '完善资料',   1, 'REGISTER_MERCHANT', 1, 'LIFETIME', 20,  0, 1, 30, 1),
('T_N2', '首台装机',   1, 'INSTALL',           1, 'LIFETIME', 50,  0, 1, 30, 2),
('T_N3', '首台达标',   1, 'QUALIFIED',         1, 'LIFETIME', 200, 0, 1, 30, 3),
('T_N4', '首次推荐',   1, 'REFERRAL_REG',      1, 'LIFETIME', 50,  0, 1, 30, 4),
('T_N5', '首推达标',   1, 'REFERRAL_QUALIFIED',1, 'LIFETIME', 150, 0, 1, 30, 5),
('T_N6', '团队入队',   1, 'TEAM_JOIN_3',       1, 'LIFETIME', 100, 0, 1, 30, 6);

-- 普通任务（示例，FR-3.7 可配增删）
INSERT INTO `task_template` (`code`, `name`, `task_type`, `event_type`, `threshold`, `period`, `reward_points`, `min_level`, `max_per_user`, `sort`) VALUES
('T_D1', '每日签到',     2, 'SIGN_IN',         1,    'DAY',    2,   0, 1, 7),
('T_D2', '每周活跃',     2, 'PROMO_ACTION',    3,    'WEEK',   15,  0, 1, 8),
('T_M1', '月度流水运营', 2, 'MONTH_FLOW',      5000, 'MONTH', 100, 1, 1, 9),
('T_M2', '月度达标率',   2, 'MONTH_REACH_RATE',80,   'MONTH', 50,  1, 1, 10),
('T_A1', '成就:初具规模',3, 'REACH_RECOMMEND', 3,    'LIFETIME', 300, 1, 1, 11),
('T_A2', '成就:团队分红',3, 'TEAM_DIVIDEND',   1,    'LIFETIME', 200, 1, 1, 12);

-- 基础权限点（RBAC）
INSERT INTO `admin_permission` (`code`, `name`, `module`, `sensitive`) VALUES
('user:query', '用户查询', 'user', 0),
('user:freeze', '用户冻结/封禁', 'user', 1),
('points:query', '积分流水查询', 'points', 0),
('points:adjust', '积分调账', 'points', 1),
('mall:manage', '商品管理', 'mall', 0),
('mall:cost_override', '超成本上架审批', 'mall', 1),
('task:manage', '任务管理', 'task', 0),
('gift:approve', '赠送活动审批', 'gift', 1),
('tier:manage', '等级规则配置', 'tier', 1),
('pool:query', '分润池查询', 'pool', 0),
('pool:config', '分润池参数配置', 'pool', 1),
('pool:guard_release', '保护状态人工恢复', 'pool', 1),
('risk:manage', '风控处置', 'risk', 1),
('audit:query', '操作日志查询', 'audit', 0);

INSERT INTO `admin_role_permission` (`role`, `permission_id`)
SELECT 'SUPER_ADMIN', `id` FROM `admin_permission`;

INSERT INTO `admin_role_permission` (`role`, `permission_id`)
SELECT 'OPERATOR', `id` FROM `admin_permission` WHERE `sensitive` = 0;

-- =====================================================================
-- 文件结束
-- 建库: mysql -u admin -p < db/demo-schema.sql
-- 后续迭代（M3）: point_flow / room_op_log 按月分区；风控宽表；权重物化字段
-- =====================================================================
