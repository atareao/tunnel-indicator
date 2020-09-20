#!/usr/bin/env gjs

const {GObject, Gtk} = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const Gettext = imports.gettext.domain(Extension.uuid);
const _ = Gettext.gettext;

var EntryDialog = GObject.registerClass(
    class EntryDialog extends Gtk.Dialog{
        _init(label){
            super._init();
            let grid = new Gtk.Grid();
            grid.set_row_spacing(5);
            grid.set_column_spacing(5);
            grid.set_margin_start(5);
            grid.set_margin_end(5);
            grid.set_margin_top(5);
            grid.set_margin_bottom(5);
            this.get_content_area().add(grid);
            this._label = Gtk.Label.new(label);
            grid.attach(this._label, 0, 0, 1, 1);
            this._entry = new Gtk.Entry();
            grid.attach(this._entry, 1, 0, 1, 1);

            this.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
            this.add_button(_('Ok'), Gtk.ResponseType.OK);
            this.show_all();
        }

        setLabel(label){
            this._label.set_text(label);
        }
        getEntry(){
            return this._entry.get_text();
        }
    }
);
