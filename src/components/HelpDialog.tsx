import { Check, ShieldCheck, X } from "../icons";

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? (
    <div className="modal-backdrop" onClick={() => onClose()}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="使用指南"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" aria-label="关闭" onClick={() => onClose()}>
          <X size={20} />
        </button>
        <span className="eyebrow">使用指南</span>
        <h2>插入 U 盘，剩下的交给零跑记录仪。</h2>
        <ol>
          <li>
            <b>自动发现录像</b>
            <p>
              应用每 8 秒寻找已连接的零跑 U 盘，自动读取行车与哨兵目录。无需选文件夹，也不会向 U
              盘写入内容。
            </p>
          </li>
          <li>
            <b>一大三小，自由切换</b>
            <p>
              点击右侧任一小画面切换主视角；点击放大图标进入单路全屏。四路来自同一个视频帧，播放和跳转始终同步。
            </p>
          </li>
          <li>
            <b>看得自然，也看得完整</b>
            <p>
              默认开启鱼眼校正。关闭可看原始广角，扩大视野可看更多周边，但边缘会有透视拉伸。校正仅改变显示，不修改录像。
            </p>
          </li>
        </ol>
        <div className="help-note">
          <ShieldCheck size={18} />
          首次打开录像会在电脑临时目录建立播放缓存。录影不上传，U 盘文件不移动、不改名、不覆盖。原始
          H.264 录像会自动封装为可播放格式。
        </div>
        <button className="primary" onClick={() => onClose()}>
          <Check size={16} />
          开始回看
        </button>
      </section>
    </div>
  ) : null;
}
