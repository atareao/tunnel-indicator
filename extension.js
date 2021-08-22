/*
 * tunnel-indicator@atareao.es
 *
 * Copyright (c) 2020 Lorenzo Carbonell Cerezo <a.k.a. atareao>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

imports.gi.versions.Gtk = "3.0";
imports.gi.versions.Gdk = "3.0";
imports.gi.versions.Gio = "2.0";
imports.gi.versions.Clutter = "1.0";
imports.gi.versions.St = "1.0";
imports.gi.versions.GObject = "3.0";
imports.gi.versions.GLib = "2.0";

const {Gtk, Gdk, Gio, Clutter, St, GObject, GLib} = imports.gi;

const MessageTray = imports.ui.messageTray;
const ByteArray = imports.byteArray;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const Convenience = Extension.imports.convenience;

const Gettext = imports.gettext.domain(Extension.uuid);
const _ = Gettext.gettext;

var button;

function notify(msg, details, icon='tasker') {
    let source = new MessageTray.Source(Extension.uuid, icon);
    Main.messageTray.add(source);
    let notification = new MessageTray.Notification(source, msg, details);
    notification.setTransient(true);
    source.notify(notification);
}

var TunnelIndicator = GObject.registerClass(
    class TunnelIndicator extends PanelMenu.Button{
        _init(){
            super._init(St.Align.START);
            this._settings = Convenience.getSettings();

            /* Icon indicator */
            Gtk.IconTheme.get_default().append_search_path(
                Extension.dir.get_child('icons').get_path());

            let box = new St.BoxLayout();
            let label = new St.Label({text: 'Button',
                                      y_expand: true,
                                      y_align: Clutter.ActorAlign.CENTER });
            //box.add(label);
            this.icon = new St.Icon({style_class: 'system-status-icon'});
            //this._update();
            box.add(this.icon);
            this.add_child(box);
            /* Start Menu */
            this.TunnelSwitch = new PopupMenu.PopupSwitchMenuItem(
                _('Wireguard status'),
                {active: true});
            this.TunnelSwitch.label.set_text(_('Enable Tunnel'));
            this.TunnelSwitch.connect('toggled',
                                         this._toggleSwitch.bind(this));
            //this.TunnelSwitch.connect('toggled', (widget, value) => {
            //    this._toggleSwitch(value);
            //});
            log("Antes");
            this.tunnels_section = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this.tunnels_section);
            this.tunnels_section.addMenuItem(this.TunnelSwitch);
            log("Después");
            /* Separator */
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            /* Setings */
            this.settingsMenuItem = new PopupMenu.PopupMenuItem(_("Settings"));
            this.settingsMenuItem.connect('activate', () => {
                ExtensionUtils.openPrefs();
            });
            this.menu.addMenuItem(this.settingsMenuItem);
            /* Help */
            this.menu.addMenuItem(this._get_help());
            /* Init */
            this._sourceId = 0;
            this._settingsChanged();
            this._settings.connect('changed',
                                   this._settingsChanged.bind(this));
        }
        _getValue(keyName){
            return this._settings.get_value(keyName).deep_unpack();
        }

        _update(){
            let all_on = false;
            this._tunnelSwitches.forEach((tunnelSwitch, index, array)=>{
                log(tunnelSwitch.label.get_text());
                let command = 'pgrep -f "ssh ' + tunnelSwitch.label.get_name() + '"';
                let [res, out, err, status] = GLib.spawn_command_line_sync(command);
                log(command);
                if(status == 0){
                    all_on = true;
                }
                tunnelSwitch.setToggleState(status == 0);
            });
            log('Tunnel indicator: ' + all_on);
            log(new Date().getTime());
            this._set_icon_indicator(all_on);
            return true;
        }

        _set_icon_indicator(active){
            if(this.TunnelSwitch){
                let msg = '';
                let status_string = '';
                let darktheme = this._getValue('darktheme');
                if(active){
                    msg = _('Disable Tunnel');
                    status_string = 'active';
                }else{
                    msg = _('Enable Tunnel');
                    status_string = 'paused';
                }
                GObject.signal_handlers_block_by_func(this.TunnelSwitch,
                                                      this._toggleSwitch);
                this.TunnelSwitch.setToggleState(active);
                GObject.signal_handlers_unblock_by_func(this.TunnelSwitch,
                                                        this._toggleSwitch);
                this.TunnelSwitch.label.set_text(msg);
                let theme_string = (darktheme?'dark': 'light');
                let icon_string = 'tunnel-' + status_string + '-' + theme_string;
                this.icon.set_gicon(this._get_icon(icon_string));
            }
        }
        _get_icon(icon_name){
            let base_icon = Extension.path + '/icons/' + icon_name;
            let file_icon = Gio.File.new_for_path(base_icon + '.png')
            if(file_icon.query_exists(null) == false){
                file_icon = Gio.File.new_for_path(base_icon + '.svg')
            }
            if(file_icon.query_exists(null) == false){
                return null;
            }
            let icon = Gio.icon_new_for_string(file_icon.get_path());
            return icon;
        }

        _create_help_menu_item(text, icon_name, url){
            let icon = this._get_icon(icon_name);
            let menu_item = new PopupMenu.PopupImageMenuItem(text, icon);
            menu_item.connect('activate', () => {
                Gio.app_info_launch_default_for_uri(url, null);
            });
            return menu_item;
        }
        _createActionButton(iconName, accessibleName){
            let icon = new St.Button({ reactive:true,
                                       can_focus: true,
                                       track_hover: true,
                                       accessible_name: accessibleName,
                                       style_class: 'system-menu-action'});
            icon.child = new St.Icon({icon_name: iconName });
            return icon;
        }

        _get_help(){
            let menu_help = new PopupMenu.PopupSubMenuMenuItem(_('Help'));
            menu_help.menu.addMenuItem(this._create_help_menu_item(
                _('Project Page'), 'info', 'https://github.com/atareao/tunnel-indicator/'));
            menu_help.menu.addMenuItem(this._create_help_menu_item(
                _('Get help online...'), 'help', 'https://www.atareao.es/aplicacion/tunnel-indicator/'));
            menu_help.menu.addMenuItem(this._create_help_menu_item(
                _('Report a bug...'), 'bug', 'https://github.com/atareao/tunnel-indicator/issues'));

            menu_help.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            
            menu_help.menu.addMenuItem(this._create_help_menu_item(
                _('El atareao'), 'atareao', 'https://www.atareao.es'));
            menu_help.menu.addMenuItem(this._create_help_menu_item(
                _('GitHub'), 'github', 'https://github.com/atareao'));
            menu_help.menu.addMenuItem(this._create_help_menu_item(
                _('Twitter'), 'twitter', 'https://twitter.com/atareao'));
            menu_help.menu.addMenuItem(this._create_help_menu_item(
                _('Telegram'), 'telegram', 'https://t.me/canal_atareao'));
            menu_help.menu.addMenuItem(this._create_help_menu_item(
                _('Mastodon'), 'mastodon', 'https://mastodon.social/@atareao'));
            menu_help.menu.addMenuItem(this._create_help_menu_item(
                _('Spotify'), 'spotify', 'https://open.spotify.com/show/2v0fC8PyeeUTQDD67I0mKW'));
            menu_help.menu.addMenuItem(this._create_help_menu_item(
                _('YouTube'), 'youtube', 'http://youtube.com/c/atareao'));
            return menu_help;
        }
        _toggleSwitch(widget, value){
            let command = widget.label.get_name();
            let command_check = 'pgrep -f "ssh ' + command +'"';
            let [res, out, err, status] = GLib.spawn_command_line_sync(command_check);
            if((status == 0) !== value){
                let acommand = null;
                if(value){
                    acommand = ['ssh'].concat(command.split(' '));
                }else{
                    let pid = ByteArray.toString(out).split('\n')[0];
                    acommand = ['kill', pid];
                }
                if (acommand != null){
                    try{
                        let proc = Gio.Subprocess.new(
                            acommand,
                            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                        );
                        proc.communicate_utf8_async(null, null, (proc, res) => {
                            try {
                                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                                log(stdout);
                                //let active = (stdout.indexOf('Active: active') > -1);
                                this._update();
                            } catch (e) {
                                logError(e);
                            } finally {
                                //loop.quit();
                            }
                        });
                    } catch (e) {
                        logError(e);
                    }
                }
            }
        }
        _settingsChanged(){
            this._checktime = this._getValue('checktime');
            this._darkthem = this._getValue('darktheme')
            this._tunnels = this._getValue('tunnels');
            this._tunnelSwitches = [];
            let all_on = false;
            this.tunnels_section.actor.hide();
            if(this.tunnels_section.numMenuItems > 0){
                this.tunnels_section.removeAll();
            }
            for(let i=0;i<this._tunnels.length;i++){
                let [name, command] = this._tunnels[i].split("|");
                command = command || name;
                let tunnelSwitch = new PopupMenu.PopupSwitchMenuItem(
                    name,
                    {active: true});
                tunnelSwitch.label.set_name(command);
                tunnelSwitch.connect('toggled', this._toggleSwitch.bind(this));
                /*
                tunnelSwitch.connect('toggled',
                                     (widget)=>{
                                         log('Label: '+ widget.label.get_text());

                                     });
                */
                this._tunnelSwitches.push(tunnelSwitch);
                this.tunnels_section.addMenuItem(tunnelSwitch);
            }
            this.tunnels_section.actor.show();
            log('Tunnel indicator: ' + all_on);
            log(new Date().getTime());
            this._set_icon_indicator(all_on);
            this._update();
            log('After update');
            if(this._sourceId > 0){
                GLib.source_remove(this._sourceId);
            }
            log('Check time:' + this._checktime);
            this._sourceId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, this._checktime,
                this._update.bind(this));
            log('Source id:' + this._sourceId);
        }
    }
);

let tunnelIndicator;

function init(){
    Convenience.initTranslations();
}

function enable(){
    tunnelIndicator = new TunnelIndicator();
    Main.panel.addToStatusArea('tunnelIndicator', tunnelIndicator, 0, 'right');
}

function disable() {
    tunnelIndicator.destroy();
}
