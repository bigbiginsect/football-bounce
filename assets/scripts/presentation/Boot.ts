import { _decorator, Component, Label, Node, UITransform, Color } from 'cc';

const { ccclass } = _decorator;

/** 阶段 0 启动画面；不创建比赛，不采用尚未确定的玩法参数。 */
@ccclass('Boot')
export class Boot extends Component {
    start(): void {
        const title = new Node('StartupStatus');
        title.layer = this.node.layer;
        this.node.addChild(title);
        title.addComponent(UITransform).setContentSize(900, 260);
        const label = title.addComponent(Label);
        label.string = '足球弹弹乐\n工程基础已就绪\nCocos Creator 3.8.8';
        label.fontSize = 36;
        label.lineHeight = 64;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = new Color(240, 245, 255, 255);
    }
}
