import { default as RiShieldCheckLine } from "@carbon/icons-react/es/Security.js";
import { Button } from "@/components/base/buttons/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal isOpen={open} onOpenChange={(next) => !next && onClose()} size="lg">
      {({ close }) => (
        <>
          <ModalHeader
            title="选择录像文件夹，开始本地回放。"
            description="使用指南"
            icon={RiShieldCheckLine}
          />
          <ModalBody>
            <ol className="ms-5 list-decimal space-y-5 text-body-regular text-text-secondary">
              <li>
                <p className="text-body-medium text-text-primary">选择 U 盘或录像文件</p>
                <p className="mt-1">
                  点击「选择文件夹」，在系统文件选择器中打开 U 盘，选择整个盘或 driverecord /
                  sentinel 文件夹。也可以「多选录像文件」直接打开 .h264。
                  刷新或重新打开网页后，需要重新选择文件授权读取。
                </p>
              </li>
              <li>
                <p className="text-body-medium text-text-primary">一大三小，自由切换</p>
                <p className="mt-1">
                  点击右侧任一小画面切换主视角；点击放大图标进入四路全屏。四路来自同一个视频帧，播放和跳转始终同步。
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
                录像在浏览器中封装和播放，不上传到任何服务器，不修改 U 盘原文件。
                首次使用需加载播放组件；切换片段会释放上一段的播放缓存。单段支持最大 512 MB，
                手机处理大文件可能受可用内存限制。
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
