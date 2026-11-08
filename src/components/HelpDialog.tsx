import { RiShieldCheckLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal isOpen={open} onOpenChange={(next) => !next && onClose()} size="lg">
      {({ close }) => (
        <>
          <ModalHeader
            title="插入 U 盘，剩下的交给零跑记录仪。"
            description="使用指南"
            icon={RiShieldCheckLine}
          />
          <ModalBody>
            <ol className="ms-5 list-decimal space-y-5 text-body-regular text-text-secondary">
              <li>
                <p className="text-body-medium text-text-primary">发现录像：电脑自动 / 手机手动</p>
                <p className="mt-1">
                  电脑插入 U 盘后，本机或同一局域网手机会自动扫描（只读）。iPhone 若把 U
                  盘插在手机上，Safari 无法后台直读挂载卷：请点「选择文件夹」，在「文件」App 打开 U
                  盘（常见名「NO NAME」），选中整个盘或{" "}
                  <code className="text-caption-1-medium">driverecord</code>{" "}
                  目录。选完会有进度与错误提示，不会静默失败。
                </p>
              </li>
              <li>
                <p className="text-body-medium text-text-primary">一大三小，自由切换</p>
                <p className="mt-1">
                  点击右侧任一小画面切换主视角；点击放大图标进入单路全屏。四路来自同一个视频帧，播放和跳转始终同步。
                </p>
              </li>
              <li>
                <p className="text-body-medium text-text-primary">看得自然，也看得完整</p>
                <p className="mt-1">
                  默认开启鱼眼校正。关闭可看原始广角，扩大视野可看更多周边，但边缘会有透视拉伸。校正仅改变显示，不修改录像。
                </p>
              </li>
            </ol>
            <div className="mt-6 flex gap-3 rounded-2lg border border-separator-border bg-background-secondary-default p-4 text-body-2-regular text-text-secondary">
              <RiShieldCheckLine className="mt-0.5 size-5 shrink-0 text-accent-600" aria-hidden />
              <p>
                首次打开录像会在电脑临时目录建立播放缓存。录影不上传，U
                盘文件不移动、不改名、不覆盖。原始 H.264 录像会自动封装为可播放格式。
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              onClick={() => {
                close();
                onClose();
              }}
            >
              开始回看
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
