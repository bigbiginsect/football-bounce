import { Color, Graphics, Label, Mask, Node, Sprite, SpriteFrame, UITransform, isValid } from 'cc';
import type { Vector2Data } from '../core/GameState';
import type { PlayerCatalog, PlayerTemplate } from '../core/PlayerCatalog';
import { getPlayerTemplate, playerRarityPresentation, playerSkillPresentation } from '../core/PlayerCatalog';

type StatIcon = 'weight' | 'power' | 'precision' | 'mentality' | 'curve';
const infoCloseCenter = { x: 296, y: 535 } as const;
const infoFooterCenter = { x: 0, y: -500 } as const;

/** 信息卡复用原视觉；不处理阵容命令或页面导航。 */
export class PlayerInfoView {
    private infoPanel?: Node;
    constructor(private readonly root: Node, private readonly catalog: PlayerCatalog,
        private readonly portraits: ReadonlyMap<string, SpriteFrame>) {}
    get isOpen(): boolean { return Boolean(this.infoPanel); }
    show(templateId: string): void {
        this.close();
        const template = getPlayerTemplate(this.catalog, templateId);
        const [r, g, b] = playerRarityPresentation(template.rarity).rgb;
        const rarity = new Color(r, g, b);
        const overall = this.overall(template);
        const overlay = this.node(this.root, `Info-${templateId}`, 720, 1280); overlay.setSiblingIndex(this.root.children.length - 1);
        const shade = overlay.addComponent(Graphics); shade.fillColor = new Color(3, 15, 20, 220);
        shade.rect(-360, -640, 720, 1280); shade.fill();

        this.panel(overlay, 'InfoShadow', 680, 1170, 0, -9, new Color(4, 23, 29, 230), 34);
        const card = this.panel(overlay, 'InfoCard', 672, 1170, 0, 0, new Color(235, 244, 235), 32);
        const frame = card.getComponent(Graphics)!; frame.strokeColor = rarity;
        frame.lineWidth = 7; frame.stroke();

        const header = this.panel(card, 'Header', 666, 90, 0, 535, new Color(44, 75, 88), 29);
        const headerLine = header.getComponent(Graphics)!; headerLine.strokeColor = new Color(137, 205, 202);
        headerLine.lineWidth = 3; headerLine.stroke();
        this.soccerBall(header, 48, -138, 0);
        this.label(header, '球员信息', 10, 0, 34, 300);
        const close = this.panel(card, 'Close', 62, 62, infoCloseCenter.x, infoCloseCenter.y,
            new Color(223, 40, 54), 13);
        const closeBorder = close.getComponent(Graphics)!; closeBorder.strokeColor = new Color(128, 18, 30);
        closeBorder.lineWidth = 4; closeBorder.stroke();
        this.closeIcon(close);

        this.portraitMedallion(card, templateId, -226, 376);
        const portraitTag = this.panel(card, 'PortraitTag', 132, 42, -226, 280,
            rarity, 18);
        const tagBorder = portraitTag.getComponent(Graphics)!; tagBorder.strokeColor = new Color(38, 48, 64);
        tagBorder.lineWidth = 3; tagBorder.stroke();
        this.label(portraitTag, playerRarityPresentation(template.rarity).name, 0, 0, 19, 126);

        this.panel(card, 'IdentityShadow', 402, 130, 102, 388,
            new Color(182, 90, 39, 140), 18);
        const identity = this.panel(card, 'Identity', 402, 130, 102, 397,
            rarity, 18);
        const identityBorder = identity.getComponent(Graphics)!; identityBorder.strokeColor = new Color(255, 207, 148);
        identityBorder.lineWidth = 3; identityBorder.stroke();
        const identityName = this.label(identity, template.name, -70, 24, 35, 220);
        identityName.overflow = Label.Overflow.SHRINK;
        this.label(identity, '五维能力档案 · 评分 0—100', -68, -23, 18, 230, new Color(255, 239, 219));
        const rating = this.panel(identity, 'Overall', 92, 96, 137, 0, new Color(194, 84, 37, 210), 14);
        this.label(rating, '综合', 0, 24, 16, 82, new Color(255, 229, 202));
        this.label(rating, String(overall), 0, -15, 34, 82);

        const quipPanel = this.panel(card, 'Quip', 402, 94, 102, 276, new Color(249, 252, 244), 17);
        const quipBorder = quipPanel.getComponent(Graphics)!; quipBorder.strokeColor = new Color(203, 217, 205);
        quipBorder.lineWidth = 2; quipBorder.stroke();
        const quip = this.label(quipPanel, `“${template.quip}”`, 0, 0, 20, 370, new Color(38, 62, 74));
        quip.enableWrapText = true; quip.lineHeight = 27; quip.overflow = Label.Overflow.SHRINK;
        quip.node.getComponent(UITransform)?.setContentSize(370, 76);

        this.label(card, '能力属性', -252, 204, 23, 150, new Color(35, 80, 83));
        this.label(card, '评分范围 0—100', 220, 204, 16, 190, new Color(102, 128, 122));
        this.stat(card, '重量', template.weight, -157, 132, 'weight');
        this.stat(card, '力量', template.power, 157, 132, 'power');
        this.stat(card, '精准', template.precision, -157, 16, 'precision');
        this.stat(card, '弧度', template.curve, 157, 16, 'curve');
        this.stat(card, '心态', template.mentality, -157, -100, 'mentality');

        const skills = this.panel(card, 'Skills', 628, 164, 0, -246, new Color(250, 252, 246), 19);
        const skillsGraphic = skills.getComponent(Graphics)!; skillsGraphic.strokeColor = new Color(147, 174, 156);
        skillsGraphic.lineWidth = 3; skillsGraphic.stroke();
        this.skillIcon(skills, -242, 0);
        const skill = playerSkillPresentation(template);
        const skillTitle = this.label(skills, skill ? `【${skill.name}】` : '【专属技能】', 52, 48, 23, 420,
            new Color(226, 83, 37));
        skillTitle.overflow = Label.Overflow.SHRINK;
        const skillText = skill
            ? skill.description
            : '技能系统尚未启用，效果与解锁条件将在后续版本确定。';
        const description = this.label(skills, skillText, 52, -25, 18, 420, new Color(44, 66, 78));
        description.enableWrapText = true; description.lineHeight = 25;
        description.overflow = Label.Overflow.SHRINK;
        description.node.getComponent(UITransform)?.setContentSize(420, 82);

        this.pitchDecoration(card);
        this.panel(card, 'ActionShadow', 316, 72, 0, -507, new Color(13, 91, 38), 19);
        const footer = this.button(card, '返回阵容', infoFooterCenter.x, infoFooterCenter.y,
            306, 68, new Color(24, 202, 67));
        const footerBorder = footer.getComponent(Graphics)!; footerBorder.strokeColor = new Color(13, 116, 42);
        footerBorder.lineWidth = 4; footerBorder.stroke();
        this.infoPanel = overlay;
    }

    close(): void {
        if (this.infoPanel && isValid(this.infoPanel, true)) this.infoPanel.destroy();
        this.infoPanel = undefined;
    }

    private overall(template: PlayerTemplate): number {
        return Math.round((template.weight + template.power + template.precision
            + template.mentality + template.curve) / 5);
    }

    private stat(parent: Node, name: string, value: number, x: number, y: number, icon: StatIcon): void {
        this.panel(parent, `StatShadow-${name}`, 296, 106, x, y - 3, new Color(167, 185, 178, 150), 16);
        const tile = this.panel(parent, `Stat-${name}`, 296, 106, x, y, new Color(250, 253, 249), 16);
        const g = tile.getComponent(Graphics)!; g.strokeColor = new Color(211, 223, 217); g.lineWidth = 2; g.stroke();
        this.statIcon(tile, icon, -111, 14);
        this.label(tile, name, -43, 27, 21, 96, new Color(34, 59, 73));
        this.label(tile, String(value), 106, 27, 29, 62, new Color(22, 111, 43));
        const filled = Math.max(0, Math.min(8, Math.round(value / 12.5)));
        for (let index = 0; index < 8; index++) {
            const color = index < filled ? new Color(39, 216, 70) : new Color(166, 177, 187);
            const segment = this.panel(tile, `Segment-${index}`, 21, 15, -61 + index * 25, -27, color, 4);
            const segmentGraphic = segment.getComponent(Graphics)!;
            segmentGraphic.strokeColor = index < filled ? new Color(16, 164, 45) : new Color(126, 138, 150);
            segmentGraphic.lineWidth = 1; segmentGraphic.stroke();
        }
    }

    hitClose(point: Vector2Data): boolean {
        const top = Math.abs(point.x - infoCloseCenter.x) <= 38
            && Math.abs(point.y - infoCloseCenter.y) <= 38;
        const footer = Math.abs(point.x - infoFooterCenter.x) <= 160
            && Math.abs(point.y - infoFooterCenter.y) <= 40;
        return top || footer;
    }

    private portraitMedallion(parent: Node, templateId: string, x: number, y: number): void {
        this.circle(parent, 'PortraitShadow', 200, x, y - 6, new Color(11, 38, 53, 190));
        this.circle(parent, 'PortraitOuter', 200, x, y, new Color(43, 78, 101), new Color(17, 48, 65), 4);
        this.circle(parent, 'PortraitRing', 184, x, y, new Color(112, 196, 225), new Color(225, 246, 244), 3);
        this.circle(parent, 'PortraitAccent', 170, x, y, new Color(248, 102, 43));
        this.avatar(parent, templateId, 160, x, y);
    }

    private statIcon(parent: Node, icon: StatIcon, x: number, y: number): void {
        const tile = this.panel(parent, `Icon-${icon}`, 58, 58, x, y, new Color(35, 58, 74), 11);
        const border = tile.getComponent(Graphics)!; border.strokeColor = new Color(18, 36, 50);
        border.lineWidth = 2; border.stroke();
        const art = this.node(tile, 'Art', 50, 50).addComponent(Graphics);
        art.strokeColor = new Color(239, 246, 244); art.fillColor = new Color(255, 177, 60); art.lineWidth = 5;
        if (icon === 'weight') {
            art.moveTo(-16, 0); art.lineTo(16, 0); art.stroke();
            art.fillColor = new Color(255, 177, 60);
            art.roundRect(-23, -12, 7, 24, 3); art.roundRect(16, -12, 7, 24, 3);
            art.roundRect(-14, -8, 5, 16, 2); art.roundRect(9, -8, 5, 16, 2); art.fill();
        } else if (icon === 'power') {
            art.fillColor = new Color(255, 162, 49);
            art.moveTo(3, 23); art.lineTo(-16, 2); art.lineTo(-3, 2);
            art.lineTo(-8, -22); art.lineTo(17, 7); art.lineTo(4, 7); art.lineTo(3, 23); art.fill();
        } else if (icon === 'precision') {
            art.strokeColor = new Color(240, 246, 244); art.lineWidth = 4;
            art.circle(0, 0, 15); art.stroke(); art.circle(0, 0, 5); art.stroke();
            art.moveTo(-23, 0); art.lineTo(-10, 0); art.moveTo(10, 0); art.lineTo(23, 0);
            art.moveTo(0, -23); art.lineTo(0, -10); art.moveTo(0, 10); art.lineTo(0, 23); art.stroke();
        } else if (icon === 'mentality') {
            art.fillColor = new Color(242, 58, 76);
            art.circle(-9, 8, 11); art.circle(9, 8, 11); art.fill();
            art.moveTo(-19, 6); art.lineTo(0, -21); art.lineTo(19, 6); art.fill();
            art.strokeColor = new Color(255, 215, 84); art.lineWidth = 4;
            art.moveTo(-14, 0); art.lineTo(-5, 0); art.lineTo(0, 8); art.lineTo(6, -8); art.lineTo(13, -8); art.stroke();
        } else {
            art.strokeColor = new Color(239, 246, 244); art.lineWidth = 5;
            for (let line = 0; line < 2; line++) {
                for (let step = 0; step <= 12; step++) {
                    const progress = step / 12;
                    const px = -20 + progress * 40;
                    const py = -11 + line * 10 + Math.sin(progress * Math.PI) * 21;
                    if (step === 0) art.moveTo(px, py); else art.lineTo(px, py);
                }
                art.stroke();
            }
        }
    }

    private skillIcon(parent: Node, x: number, y: number): void {
        const tile = this.panel(parent, 'SkillIcon', 108, 108, x, y, new Color(255, 177, 25), 17);
        const border = tile.getComponent(Graphics)!; border.strokeColor = new Color(240, 107, 18);
        border.lineWidth = 3; border.stroke();
        const art = this.node(tile, 'SkillArt', 98, 98).addComponent(Graphics);
        art.strokeColor = new Color(255, 246, 178); art.lineWidth = 5;
        for (let ray = 0; ray < 10; ray++) {
            const angle = ray * Math.PI * 2 / 10;
            art.moveTo(Math.cos(angle) * 25, Math.sin(angle) * 25);
            art.lineTo(Math.cos(angle) * 43, Math.sin(angle) * 43);
        }
        art.stroke();
        art.fillColor = new Color(147, 60, 15);
        art.circle(0, 0, 27); art.fill();
        art.strokeColor = new Color(255, 232, 101); art.lineWidth = 5;
        art.moveTo(-19, 8); art.lineTo(-9, -8); art.lineTo(0, 7); art.lineTo(10, -8); art.lineTo(20, 8);
        art.moveTo(-17, -11); art.lineTo(17, -11); art.stroke();
    }

    private pitchDecoration(parent: Node): void {
        const pitch = this.panel(parent, 'Pitch', 638, 220, 0, -455, new Color(116, 183, 119), 20);
        const lines = pitch.getComponent(Graphics)!; lines.strokeColor = new Color(228, 246, 222, 145);
        lines.lineWidth = 3; lines.rect(-292, -93, 584, 186); lines.stroke();
        lines.moveTo(0, -93); lines.lineTo(0, 93); lines.stroke();
        lines.circle(0, 0, 42); lines.stroke();
        lines.rect(-292, -54, 72, 108); lines.rect(220, -54, 72, 108); lines.stroke();
        this.soccerBall(pitch, 50, -277, -75);
        this.soccerBall(pitch, 50, 277, -75);
    }

    private soccerBall(parent: Node, size: number, x: number, y: number): void {
        const node = this.node(parent, 'SoccerBall', size, size); node.setPosition(x, y);
        const art = node.addComponent(Graphics); const radius = size / 2 - 2;
        art.fillColor = new Color(247, 250, 248); art.circle(0, 0, radius); art.fill();
        art.strokeColor = new Color(24, 42, 54); art.lineWidth = Math.max(2, size * 0.06);
        art.circle(0, 0, radius); art.stroke();
        art.fillColor = new Color(32, 48, 60);
        this.pentagon(art, 0, 0, radius * 0.36, -Math.PI / 2);
        for (let panel = 0; panel < 5; panel++) {
            const angle = -Math.PI / 2 + panel * Math.PI * 2 / 5;
            this.pentagon(art, Math.cos(angle) * radius * 0.72, Math.sin(angle) * radius * 0.72,
                radius * 0.22, angle);
            art.moveTo(Math.cos(angle) * radius * 0.34, Math.sin(angle) * radius * 0.34);
            art.lineTo(Math.cos(angle) * radius * 0.53, Math.sin(angle) * radius * 0.53); art.stroke();
        }
    }

    private pentagon(graphics: Graphics, x: number, y: number, radius: number, rotation: number): void {
        for (let vertex = 0; vertex <= 5; vertex++) {
            const angle = rotation + (vertex % 5) * Math.PI * 2 / 5;
            const px = x + Math.cos(angle) * radius; const py = y + Math.sin(angle) * radius;
            if (vertex === 0) graphics.moveTo(px, py); else graphics.lineTo(px, py);
        }
        graphics.fill();
    }

    private closeIcon(parent: Node): void {
        const art = this.node(parent, 'CloseIcon', 48, 48).addComponent(Graphics);
        art.strokeColor = Color.WHITE; art.lineWidth = 9;
        art.moveTo(-14, -14); art.lineTo(14, 14); art.moveTo(-14, 14); art.lineTo(14, -14); art.stroke();
    }

    private circle(parent: Node, name: string, diameter: number, x: number, y: number,
        fill: Color, stroke?: Color, lineWidth = 0): Node {
        const node = this.node(parent, name, diameter, diameter); node.setPosition(x, y);
        const graphics = node.addComponent(Graphics); graphics.fillColor = fill;
        graphics.circle(0, 0, diameter / 2); graphics.fill();
        if (stroke && lineWidth > 0) {
            graphics.strokeColor = stroke; graphics.lineWidth = lineWidth;
            graphics.circle(0, 0, diameter / 2 - lineWidth / 2); graphics.stroke();
        }
        return node;
    }

    private avatar(parent: Node, templateId: string, size: number, x: number, y: number): Node {
        const frame = this.portraits.get(templateId);
        const template = getPlayerTemplate(this.catalog, templateId);
        const avatar = this.node(parent, `Avatar-${templateId}`, size, size); avatar.setPosition(x, y);
        if (frame) {
            const mask = avatar.addComponent(Mask); mask.type = Mask.Type.GRAPHICS_ELLIPSE; mask.segments = 32;
            const image = this.node(avatar, 'Image', size, size);
            const sprite = image.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.spriteFrame = frame;
        } else {
            const art = avatar.addComponent(Graphics); art.fillColor = new Color(30, 105, 111);
            art.circle(0, 0, size / 2); art.fill();
            art.strokeColor = new Color(204, 242, 229); art.lineWidth = Math.max(2, size * 0.035);
            art.circle(0, 0, size / 2 - 2); art.stroke();
            this.label(avatar, template.name, 0, 0, template.name.length > 5 ? 18 : 22,
                size - 10, new Color(246, 252, 244));
        }
        return avatar;
    }
    private button(parent: Node, text: string, x: number, y: number, width: number, height: number,
        color: Color): Node {
        const button = this.panel(parent, `Button-${text}`, width, height, x, y, color, 12);
        this.label(button, text, 0, 0, 20, width - 6); return button;
    }
    private panel(parent: Node, name: string, width: number, height: number,
        x: number, y: number, color: Color, radius: number): Node {
        const node = this.node(parent, name, width, height); node.setPosition(x, y);
        const graphics = node.addComponent(Graphics); graphics.fillColor = color;
        if (radius) graphics.roundRect(-width / 2, -height / 2, width, height, radius);
        else graphics.rect(-width / 2, -height / 2, width, height);
        graphics.fill(); return node;
    }
    private node(parent: Node, name: string, width: number, height: number): Node {
        const node = new Node(name); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform).setContentSize(width, height); return node;
    }
    private label(parent: Node, text: string, x: number, y: number, size: number, width: number,
        color = new Color(235, 247, 244)): Label {
        const node = this.node(parent, 'Text', width, size + 24); node.setPosition(x, y);
        const label = node.addComponent(Label); label.string = text; label.fontSize = size; label.lineHeight = size + 5;
        label.horizontalAlign = Label.HorizontalAlign.CENTER; label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = color; return label;
    }
    dispose(): void { this.close(); }
}
