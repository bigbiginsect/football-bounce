import { Color, EditBox, Graphics, Label, Node, UITransform, isValid } from 'cc';
import type { LanSide, RoomStatus } from '../core/LanProtocol';
import { lanSettings } from '../core/LanProtocol';

/** 菜单只发出意图，不直接写比赛状态；地址由系统热点/Wi-Fi详情提供。 */
export class LanMenuView {
    readonly root: Node;
    private status?: Label;
    private address?: EditBox;
    private readonly buttons: Node[] = [];
    constructor(parent: Node, actions?: { local(): void; host(): void; join(address: string): void; remote?(): void }, message = '') {
        this.root = this.node(parent, 'ModeMenu', 720, 1280, 0);
        const background = this.root.addComponent(Graphics); background.fillColor = new Color(9, 27, 37);
        background.rect(-360, -640, 720, 1280); background.fill();
        if (!actions) return;
        this.label('足球弹弹乐', 460, 48);
        this.label('和朋友，来一场比赛', 395, 23);
        this.button('同机双人', 235, actions.local);
        this.button('附近联机 · 创建房间', 115, actions.host);
        const input = this.node(this.root, 'HostAddress', 600, 76, -40);
        const g = input.addComponent(Graphics); g.fillColor = new Color(230, 240, 242);
        g.roundRect(-300, -38, 600, 76, 12); g.fill();
        const value = this.node(input, 'Value', 570, 70, 0).addComponent(Label);
        value.color = new Color(20, 40, 50); value.fontSize = 28;
        value.verticalAlign = Label.VerticalAlign.CENTER;
        const placeholder = this.node(input, 'Placeholder', 570, 70, 0).addComponent(Label);
        placeholder.string = '输入房主 IP，如 192.168.43.1'; placeholder.fontSize = 23;
        placeholder.color = new Color(110, 130, 140);
        placeholder.verticalAlign = Label.VerticalAlign.CENTER;
        this.address = input.addComponent(EditBox); this.address.textLabel = value; this.address.placeholderLabel = placeholder;
        this.address.maxLength = 22; this.address.inputMode = EditBox.InputMode.SINGLE_LINE;
        this.button('附近联机 · 加入房间', -155, () => actions.join(this.address?.string ?? ''));
        this.label('先连接房主热点，或连接同一个 Wi-Fi', -270, 22);
        if (actions.remote) this.button('远程联机 · 连接电脑服务', -350, actions.remote);
        this.status = this.label(message, -515, 22, 610, 150);
        this.status.color = new Color(255, 211, 135);
    }
    showRemote(actions: { create(address: string, key: string): void; join(address: string, key: string, code: string): void; back(): void }): void {
        this.label('远程联机', 540, 42);
        this.label('两台手机可使用各自的网络', 475, 23);
        this.label('服务器地址', 405, 22);
        const address = this.edit('ServerAddress', 340, 'ws://电脑地址:8766/football', 300);
        this.label('连接口令 · 由电脑服务提供', 245, 22);
        const key = this.edit('AccessKey', 180, '输入电脑显示的连接口令', 128);
        key.inputFlag = EditBox.InputFlag.PASSWORD;
        this.label('房间码 · 加入时填写', 85, 22);
        const code = this.edit('RoomCode', 20, '6位房间码', 6);
        this.button('创建远程房间', -110, () => actions.create(address.string, key.string));
        this.button('加入远程房间', -225, () => actions.join(address.string, key.string, code.string));
        this.button('返回', -345, actions.back);
        this.label('先启动电脑服务 · 创建后把房间码告诉同学', -430, 20);
        this.status = this.label('', -535, 22, 610, 150); this.status.color = new Color(255, 211, 135);
    }
    private edit(name: string, y: number, placeholderText: string, maxLength: number): EditBox {
        const input = this.node(this.root, name, 600, 76, y);
        const g = input.addComponent(Graphics); g.fillColor = new Color(230, 240, 242);
        g.roundRect(-300, -38, 600, 76, 12); g.fill();
        const value = this.node(input, 'Value', 570, 70, 0).addComponent(Label);
        value.color = new Color(20, 40, 50); value.fontSize = 26; value.verticalAlign = Label.VerticalAlign.CENTER;
        const placeholder = this.node(input, 'Placeholder', 570, 70, 0).addComponent(Label);
        placeholder.string = placeholderText; placeholder.fontSize = 22; placeholder.color = new Color(110, 130, 140);
        placeholder.verticalAlign = Label.VerticalAlign.CENTER;
        const edit = input.addComponent(EditBox); edit.textLabel = value; edit.placeholderLabel = placeholder;
        edit.maxLength = maxLength; edit.inputMode = EditBox.InputMode.SINGLE_LINE; return edit;
    }
    showRoom(room: RoomStatus, side: LanSide, choose: () => void, leave: () => void): void {
        for (const child of [...this.root.children]) child.destroy();
        this.buttons.length = 0; this.address = undefined; this.status = undefined;
        const remote = room.kind === 'Remote';
        this.label(remote ? `远程房间 · 你是${side === 'blue' ? '蓝' : '红'}队`
            : side === 'blue' ? '附近房间 · 你是蓝队房主' : '附近房间 · 你是红队客人', 455, 32);
        this.label(remote ? `房间码：${room.code}` : side === 'blue' ? '请让同学连接你的热点' : '已连接房主', 365, 27);
        this.label(remote ? '同学连接同一服务器，输入此房间码加入\n双方准备完成后开始比赛' : side === 'blue'
            ? `同学在 Wi-Fi 详情查看网关地址\n在加入框输入该地址 · 端口 ${lanSettings.port}`
            : '各自选择首发和阵型\n双方准备完成后开始比赛', 270, 22, 620, 100);
        const ready = side === 'blue' ? room.blueReady : room.redReady;
        this.button(ready ? '已准备 · 等待对方' : '选择我的阵容', 60, () => { if (!ready) choose(); });
        this.button('退出房间', -280, leave);
        const status = this.label('', -105, 27, 620, 160);
        status.string = `${room.connected ? '双方已连接' : '等待同学加入…'}\n蓝队 ${room.blueReady ? '已准备' : '未准备'}　·　红队 ${room.redReady ? '已准备' : '未准备'}`;
    }
    setBusy(message: string): void {
        this.setMessage(message);
        for (const button of this.buttons) button.active = false;
    }
    setMessage(message: string): void { if (this.status) this.status.string = message; }
    dispose(): void { if (isValid(this.root, true)) this.root.destroy(); }
    private node(parent: Node, name: string, width: number, height: number, y: number): Node {
        const node = new Node(name); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform).setContentSize(width, height); node.setPosition(0, y); return node;
    }
    private label(text: string, y: number, size: number, width = 660, height = 70): Label {
        const label = this.node(this.root, 'Text', width, height, y).addComponent(Label);
        label.string = text; label.fontSize = size; label.lineHeight = size + 12;
        label.horizontalAlign = Label.HorizontalAlign.CENTER; label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        label.color = new Color(224, 240, 242); label.enableWrapText = true; return label;
    }
    private button(text: string, y: number, action: () => void): void {
        const node = this.node(this.root, text, 600, 84, y);
        const g = node.addComponent(Graphics); g.fillColor = new Color(35, 119, 112);
        g.roundRect(-300, -42, 600, 84, 16); g.fill();
        const label = this.label(text, y, 28, 600); node.addChild(label.node); label.node.setPosition(0, 0);
        node.on(Node.EventType.TOUCH_END, action); this.buttons.push(node);
    }
}
