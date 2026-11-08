import { default as RiShieldCheckLine } from "@carbon/icons-react/es/Security.js";
import { Button } from "@/components/base/buttons/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";

export function HelpDialog({
  open,
  onClose,
  fileSelectionLimit,
}: {
  open: boolean;
  onClose: () => void;
  fileSelectionLimit?: number;
}) {
  return (
    <Modal isOpen={open} onOpenChange={(next) => !next && onClose()} size="lg">
      {({ close }) => (
        <>
          <ModalHeader
            title={
              fileSelectionLimit ? "选择少量录像，开始本地回放。" : "选择录像文件夹，开始本地回放。"
            }
            description="使用指南"
            icon={RiShieldCheckLine}
          />
          <ModalBody>
            <ol className="ms-5 list-decimal space-y-5 text-body-regular text-text-secondary">
              <li>
                <p className="text-body-medium text-text-primary">
                  {fileSelectionLimit
                    ? `每次最多 ${fileSelectionLimit} 段录像`
                    : "选择 U 盘或录像文件"}
                </p>
                {fileSelectionLimit ? (
                  <p className="mt-1">
                    点击「添加录像」，在「浏览」中进入 U 盘的 driverecord 或 sentinel 目录，
                    选择一个 .h264
                    文件后点「打开」，新录像会追加到列表，重复文件不会重复添加。移动端
                    不提供文件夹导入；超过上限会拒绝本次选择，请重新选择。
                    每次选择会替换当前列表，刷新后需要重新选择。没有目录信息的录像默认归为行车。
                  </p>
                ) : (
                  <p className="mt-1">
                    点击「选择 U 盘/文件夹」，在系统文件选择器的「浏览」中进入 U 盘，
                    点右上角「打开」。网页会自动整理所选目录及子目录中的行车与哨兵录像，
                    无需逐个选择文件。刷新或重新打开网页后，需要重新选择。
                  </p>
                )}
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
