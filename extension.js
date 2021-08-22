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


// A simple asynchronous read loop
function readOutput(stream, lineBuffer) {
    stream.read_line_async(0, null, (stream, res) => {
        try {
            let line = stream.read_line_finish_utf8(res)[0];

            if (line !== null) {
                lineBuffer.push(line);
                readOutput(stream, lineBuffer);
            }
        } catch (e) {
            logError(e);
        }
    });
}
var TunnelIndicator = GObject.registerClass(
    class TunnelIndicator extends PanelMenu.Button{
        _init(){
            super._init(St.Align.START);
            this._settings = Convenience.getSettings();
            this._isActive = null;

            /* Icon indicator */
            let theme = Gtk.IconTheme.get_default();
            if (theme == null) {
                // Workaround due to lazy initialization on wayland
                // as proposed by @fmuellner in GNOME mutter issue #960
                theme = new Gtk.IconTheme();
                theme.set_custom_theme(St.Settings.get().gtk_icon_theme);
            }
            theme.append_search_path(
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
                _('Tunnels status'),
                {active: true});

            this.tunnels_section = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this.tunnels_section);
            this.tunnels_section.addMenuItem(this.TunnelSwitch);
            /* Separator */
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            /* Setings */
            this.settingsMenuItem = new PopupMenu.PopupMenuItem(_("Settings"));
            this.settingsMenuItem.connect('activate', () => {
                ExtensionUtils.openPrefs();
            });
            this.menu.addMenuItem(this.settingsMenuItem);
            /* Init */
            this._sourceId = 0;
            this._settingsChanged();
            this._settings.connect('changed',
                                   this._settingsChanged.bind(this));
        }

        _loadConfiguration(){
            this._tunnels = this._getValue('tunnels');
            this._checktime = this._getValue('checktime');
            if(this._checktime < 5){
                this._checktime = 5;
            }else if (this._checktime > 600){
                this._checktime = 600;
            }
            this._darkthem = this._getValue('darktheme')
            this._tunnelsSwitches = [];
            this.tunnels_section.actor.hide();
            if(this.tunnels_section.numMenuItems > 0){
                this.tunnels_section.removeAll();
            }
            this._tunnels.forEach((item, index, array)=>{
                let [name, tunnel] = item.split('|');
                let tunnelSwitch = new PopupMenu.PopupSwitchMenuItem(
                    name,
                    {active: false});
                tunnelSwitch.label.set_name(tunnel);
                tunnelSwitch.connect('toggled', this._toggleSwitch.bind(this)); 
                this._tunnelsSwitches.push(tunnelSwitch);
                this.tunnels_section.addMenuItem(tunnelSwitch);
                this.tunnels_section.actor.show();
            });
        }

        _checkStatus(){
            let isActive = false;
            this._tunnelsSwitches.forEach((tunnelSwitch)=>{
                if(tunnelSwitch.state){
                    isActive = true;
                }
            });
            if(this._isActive == null || this._isActive != isActive){
                this._isActive = isActive;
                this._set_icon_indicator(this._isActive);
            }
        }

        _executeCommandAsync(command){
            try {
                let [, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
                    // Working directory, passing %null to use the parent's
                    null,
                    // An array of arguments
                    command,
                    // Process ENV, passing %null to use the parent's
                    null,
                    // Flags; we need to use PATH so `ls` can be found and also need to know
                    // when the process has finished to check the output and status.
                    GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                    // Child setup function
                    null
                );

                // Any unsused streams still have to be closed explicitly, otherwise the
                // file descriptors may be left open
                GLib.close(stdin);

                // Okay, now let's get output stream for `stdout`
                let stdoutStream = new Gio.DataInputStream({
                    base_stream: new Gio.UnixInputStream({
                        fd: stdout,
                        close_fd: true
                    }),
                    close_base_stream: true
                });

                // We'll read the output asynchronously to avoid blocking the main thread
                let stdoutLines = [];
                readOutput(stdoutStream, stdoutLines);

                // We want the real error from `stderr`, so we'll have to do the same here
                let stderrStream = new Gio.DataInputStream({
                    base_stream: new Gio.UnixInputStream({
                        fd: stderr,
                        close_fd: true
                    }),
                    close_base_stream: true
                });

                let stderrLines = [];
                readOutput(stderrStream, stderrLines);

                // Watch for the process to finish, being sure to set a lower priority than
                // we set for the read loop, so we get all the output
                GLib.child_watch_add(GLib.PRIORITY_DEFAULT_IDLE, pid, (pid, status) => {
                    if (status === 0) {
                        log(stdoutLines.join('\n'));
                    } else {
                        logError(new Error(stderrLines.join('\n')));
                    }
                    // Ensure we close the remaining streams and process
                    stdoutStream.close(null);
                    GLib.spawn_close_pid(pid);
                    this._update();
                });
            } catch (e) {
                logError(e);
            }
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
                this._executeCommandAsync(acommand, this._update);
            }
        }
        _getValue(keyName){
            return this._settings.get_value(keyName).deep_unpack();
        }

        _update(){
            this._tunnelsSwitches.forEach((tunnelSwitch, index, array)=>{
                try{
                    const tunnel = tunnelSwitch.label.name;
                    const command = `pgrep -f "ssh ${tunnel}"`;
                    const [, , , ison] = GLib.spawn_command_line_sync(command);
                    GObject.signal_handlers_block_by_func(
                        tunnelSwitch, this._toggleSwitch);
                    tunnelSwitch.setToggleState(ison == 0);
                    GObject.signal_handlers_unblock_by_func(
                        tunnelSwitch, this._toggleSwitch);
                    this._checkStatus();
                } catch (e) {
                    logError(e);
                }
            });
            return true;
        }

        _set_icon_indicator(active){
            let darktheme = this._getValue('darktheme');
            let theme_string = (darktheme?'dark': 'light');
            let status_string = (active?'active':'paused')
            let icon_string = 'tunnel-' + status_string + '-' + theme_string;
            this.icon.set_gicon(this._get_icon(icon_string));
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

        _settingsChanged(){
            this._loadConfiguration();
            this._update();
            if(this._sourceId > 0){
                GLib.source_remove(this._sourceId);
            }
            this._sourceId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, this._checktime,
                this._update.bind(this));
        }

        disableUpdate(){
            if(this._sourceId > 0){
                GLib.source_remove(this._sourceId);
            }
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
    tunnelIndicator.disableUpdate();
    tunnelIndicator.destroy();
}
