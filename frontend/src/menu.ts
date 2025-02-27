// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { createElement as h, useEffect, useState } from 'react'
import { useDebounce } from 'use-debounce'
import { confirmDialog, promptDialog } from './dialog'
import { hIcon, isMobile, prefix } from './misc'
import { login } from './login'
import { showOptions } from './options'
import showUserPanel from './UserPanel'
import { useNavigate } from 'react-router-dom'
import _ from 'lodash'

export function MenuPanel() {
    const { showFilter, remoteSearch, stopSearch, stoppedSearch, patternFilter, selected } = useSnapState()
    const [filter, setFilter] = useState(patternFilter)
    ;[state.patternFilter] = useDebounce(showFilter ? filter : '', 300)
    useEffect(() => {
        if (!showFilter)
            state.selected = {}
    }, [showFilter])

    const [started1secAgo, setStarted1secAgo] = useState(false)
    useEffect(() => {
        if (!stopSearch) return
        setStarted1secAgo(false)
        setTimeout(() => setStarted1secAgo(true), 1000)
    }, [stopSearch])

    //TODO do something for list > 63KB as it hit the url limit (1kb reserved for the rest for the url)
    const list = Object.keys(selected).map(s => s.endsWith('/') ? s.slice(0,-1) : s).join('*')
    return h('div', { id: 'menu-panel' },
        h('div', { id: 'menu-bar' },
            h(LoginButton),
            h(MenuButton, {
                icon: 'filter',
                label: "Filter list",
                tooltip: "Show only elements matching text you type. Works on list already got from the server. Also enables selection of files, for selective \"Download zip\".",
                toggled: showFilter,
                onClick() {
                    state.showFilter = !showFilter
                }
            }),
            h(MenuButton, getSearchProps()),
            h(MenuButton, {
                icon: 'settings',
                label: 'Options',
                onClick: showOptions
            }),
            h(MenuLink, {
                icon: 'archive',
                label: "Download zip",
                tooltip: "Download whole list (unfiltered) as a single zip file. If you select some elements, only those will be downloaded.",
                href: '?'+String(new URLSearchParams(_.pickBy({
                    get: 'zip',
                    search: remoteSearch,
                    list
                }))),
                confirm: list ? undefined : remoteSearch ? 'Download results of this search as ZIP archive?' : 'Download whole folder as ZIP archive?',
            })
        ),
        remoteSearch && h('div', { id: 'searched' },
            (stopSearch ? 'Searching' : 'Searched') + ': ' + remoteSearch + prefix(' (', stoppedSearch && 'interrupted', ')')),
        showFilter && h('div', { id: 'filter-bar' },
            h('input', {
                id: 'filter',
                placeholder: "Type here to filter the list below",
                autoComplete: 'off',
                value: filter,
                autoFocus: true,
                onChange(ev) {
                    setFilter(ev.target.value)
                }
            }),
            !isMobile() && h(MenuButton, {
                icon: 'check',
                label: "Select all",
                onClick() { workSel(() => true) }
            }),
            h(MenuButton, {
                icon: 'invert',
                label: 'Invert selection',
                onClick() { workSel(x => !x) }
            }),
        )
    )

    function workSel(cb: (b:boolean) => boolean) {
        const sel = state.selected
        for (const { n } of state.filteredList || state.list) {
            const was = sel[n]
            if (was !== cb(was))
                if (was)
                    delete sel[n]
                else
                    sel[n] = true
        }
    }

    function getSearchProps() {
        return stopSearch && started1secAgo ? {
            icon: 'stop',
            label: 'Stop list',
            className: 'ani-working',
            onClick() {
                stopSearch()
                state.stoppedSearch = true
            }
        } : state.remoteSearch && !stopSearch ? {
            icon: 'search_off',
            label: 'Clear search',
            onClick() {
                state.remoteSearch = ''
            }
        } : {
            icon: 'search',
            label: "Search deep",
            async onClick() {
                state.remoteSearch = await promptDialog('Search for...') || ''
            }
        }
    }
}

interface MenuButtonProps {
    icon: string,
    label: string,
    tooltip?: string,
    toggled?: boolean,
    className?: string,
    onClick?: () => void
}

export function MenuButton({ icon, label, tooltip, toggled, onClick, className = '' }: MenuButtonProps) {
    return h('button', { title: tooltip || label, onClick, className: className + ' ' + (toggled ? 'toggled' : '') },
        hIcon(icon),
        h('label', {}, label))
}

export function MenuLink({ href, target, confirm, ...rest }: MenuButtonProps & { href: string, target?: string, confirm?: string }) {
    return h('a', {
        tabIndex: -1,
        href,
        target,
        async onClick(ev) {
            if (!confirm) return
            ev.preventDefault()
            await confirmDialog(confirm, { href })
        }
    }, h(MenuButton, rest))
}

function LoginButton() {
    const snap = useSnapState()
    const navigate = useNavigate()
    return MenuButton(snap.username ? {
        icon: 'user',
        label: snap.username,
        onClick: showUserPanel
    } : {
        icon: 'login',
        label: 'Login',
        async onClick() {
            const user = await promptDialog('Username')
            if (!user) return
            const password = await promptDialog('Password', { type: 'password' })
            if (!password) return
            const res = await login(user, password)
            if (res?.redirect)
                navigate(res.redirect)
        }
    })
}


