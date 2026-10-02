import Gantt from './src/index.js';

const DATE_RE = /^(\d{4})\/(\d{2})\/(\d{2})$/;

const GANTT_OPTIONS = {
    arrow_curve: 5,
    auto_move_label: false,
    bar_corner_radius: 3,
    bar_height: 25,
    container_height: 'auto',
    date_format: 'YYYY/MM/DD',
    upper_header_height: 45,
    lower_header_height: 30,
    snap_at: null,
    infinite_padding: false,
    holidays: null,
    ignore: [],
    language: 'en',
    lines: 'both',
    move_dependencies: true,
    padding: 18,
    popup_on: 'click',
    readonly_progress: true,
    readonly_dates: true,
    readonly: false,
    hover_on_date: false,
    fixed_duration: false,
    scroll_to: 'start',
    show_expected_progress: false,
    today_button: false,
    view_mode: 'Year',
    view_mode_select: false,
    view_modes: [
        {
            name: 'Year',
            padding: '5y',
            step: '1y',
            column_width: 40,
            date_format: 'YYYY',
            lower_text: 'YYYY',
            snap_at: '30d',
        },
    ],
};

let tasksMany = [];
let gantt = null;
let currentProjectKey = '';
let selectedTaskId = null;
let modalMode = 'create';
let currentCsvData = [];

function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
}

function todayYmd() {
    return formatDate(new Date());
}

function isOpenEnded(end) {
    if (end == null) return true;
    const value = String(end).trim();
    if (!value) return true;
    return /^(present|null)$/i.test(value);
}

function normalizeEnd(end) {
    return isOpenEnded(end) ? null : String(end).trim();
}

function chartEndDate(start, end) {
    if (!isOpenEnded(end)) return String(end).trim();
    const today = todayYmd();
    if (parseYmd(start) && toDateInt(today) < toDateInt(start)) return start;
    return today;
}

function tasksForChart(list) {
    return list.map((task) => ({
        ...cloneItem(task),
        end: chartEndDate(task.start, task.end),
    }));
}

function getDeps(deps) {
    if (typeof deps === 'string') {
        return deps.split(',').map((d) => d.trim()).filter(Boolean);
    }
    return Array.isArray(deps) ? deps.slice() : [];
}

function formatDuration(totalDays) {
    const days = Math.floor(totalDays);
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    const remainingDays = (days % 365) % 30;
    return `${years} year(s), ${months} month(s), ${remainingDays} day(s)`;
}

function cloneItem(task) {
    return {
        id: task.id,
        name: task.name,
        start: task.start,
        end: normalizeEnd(task.end),
        dependencies: getDeps(task.dependencies),
        description: task.description || '',
        type: task.type,
    };
}

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];
    
    function parseRow(row) {
        const cols = [];
        let cur = '';
        let inQuote = false;
        for (let i = 0; i < row.length; i++) {
            if (row[i] === '"') {
                inQuote = !inQuote;
            } else if (row[i] === ',' && !inQuote) {
                cols.push(cur);
                cur = '';
            } else {
                cur += row[i];
            }
        }
        cols.push(cur);
        return cols;
    }

    const headers = parseRow(lines[0]).map(h => h.trim().toLowerCase());
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        const row = parseRow(lines[i]);
        if (row.length === 1 && row[0] === '') continue;
        const obj = {};
        for (let j = 0; j < headers.length; j++) {
            obj[headers[j]] = row[j] ? row[j].trim() : '';
        }
        result.push(obj);
    }
    return result;
}

function parseYmd(value) {
    const match = String(value || '').trim().match(DATE_RE);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }
    return date;
}

function toDateInt(value) {
    const parsed = parseYmd(value);
    if (!parsed) return 0;
    return parsed.getFullYear() * 10000 + (parsed.getMonth() + 1) * 100 + parsed.getDate();
}

function getParentPerson(task, list) {
    const deps = getDeps(task.dependencies);
    return list.find((item) => item.type === 'person' && deps.includes(item.id));
}

function getRelatedTasks(task) {
    if (task.type === 'person') {
        const children = tasksMany.filter((t) => getDeps(t.dependencies).includes(task.id));
        return {
            career: children.filter((t) => t.type === 'position'),
            family: children.filter((t) => t.type === 'person'),
        };
    }
    if (task.type === 'position') {
        const parent = tasksMany.find((t) => getDeps(task.dependencies).includes(t.id) && t.type === 'person');
        return { parent };
    }
    return {};
}

function recalculatePersonDates(list) {
    for (const person of list.filter((item) => item.type === 'person')) {
        const positions = list.filter(
            (item) => item.type === 'position' && getParentPerson(item, list)?.id === person.id,
        );
        if (!positions.length) {
            if (!parseYmd(person.start) || !parseYmd(person.end)) {
                const today = todayYmd();
                person.start = person.start || today;
                person.end = person.end || today;
            }
            continue;
        }
        const starts = positions.map((item) => parseYmd(item.start)).filter(Boolean);
        const ends = positions
            .map((item) => parseYmd(chartEndDate(item.start, item.end)))
            .filter(Boolean);
        if (!starts.length || !ends.length) continue;
        const minStart = new Date(Math.min(...starts.map((d) => d.getTime())));
        const maxEnd = new Date(Math.max(...ends.map((d) => d.getTime())));
        minStart.setMonth(minStart.getMonth() - 6);
        person.start = formatDate(minStart);
        person.end = formatDate(maxEnd);
    }
}

function groupAndSort(list) {
    const persons = list.filter((item) => item.type === 'person');
    const used = new Set();
    const result = [];

    for (const person of persons) {
        result.push(person);
        used.add(person.id);
        const children = list
            .filter((item) => item.type === 'position' && getParentPerson(item, list)?.id === person.id)
            .sort((a, b) => toDateInt(a.start) - toDateInt(b.start));
        for (const child of children) {
            result.push(child);
            used.add(child.id);
        }
    }

    for (const item of list) {
        if (!used.has(item.id)) result.push(item);
    }
    return result;
}

function processTasks(list) {
    const cloned = (Array.isArray(list) ? list : []).map(cloneItem);
    recalculatePersonDates(cloned);
    return groupAndSort(cloned);
}

function generateId(type) {
    const prefix = type;
    let n = 1;
    while (tasksMany.some((item) => item.id === `${prefix}_${n}`)) n += 1;
    return `${prefix}_${n}`;
}

function validateItem(draft, { isNew }) {
    const errors = [];
    if (!draft.id) errors.push('ID is required.');
    if (isNew && tasksMany.some((item) => item.id === draft.id)) {
        errors.push('ID must be a unique identifier.');
    }
    if (!String(draft.name || '').trim()) errors.push('Name is required.');

    if (draft.type === 'position') {
        const end = normalizeEnd(draft.end);
        if (!parseYmd(draft.start)) {
            errors.push('Start date must use valid YYYY/MM/DD format.');
        } else if (end !== null && !parseYmd(end)) {
            errors.push('End date must be blank (Present) or a valid YYYY/MM/DD date.');
        } else if (end !== null && toDateInt(end) < toDateInt(draft.start)) {
            errors.push('End Date must be greater than or equal to Start Date.');
        }
        const parent = tasksMany.find(
            (item) => item.type === 'person' && draft.dependencies.includes(item.id),
        );
        if (!parent || draft.dependencies.length !== 1) {
            errors.push('Positions cannot be orphaned; they require exactly one parent Person.');
        }
    }

    for (const dep of draft.dependencies) {
        if (dep === draft.id) errors.push('Dependencies cannot self-reference.');
        else if (!tasksMany.some((item) => item.id === dep)) {
            errors.push(`Dependency target "${dep}" does not exist.`);
        }
    }

    return [...new Set(errors)];
}

function listProjectKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        try {
            const value = JSON.parse(localStorage.getItem(key));
            if (Array.isArray(value)) keys.push(key);
        } catch {
            /* skip non-project keys */
        }
    }
    return keys.sort((a, b) => a.localeCompare(b));
}

function showEmptyProject() {
    currentProjectKey = '';
    selectedTaskId = null;
    applyTasks([]);
    refreshProjectSelect();
}

function refreshProjectSelect() {
    const select = document.getElementById('project-select');
    if (!select) return;
    const keys = listProjectKeys();
    select.innerHTML = '';

    const newOption = document.createElement('option');
    newOption.value = '';
    newOption.textContent = 'New';
    select.appendChild(newOption);

    for (const key of keys) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = key;
        select.appendChild(option);
    }

    select.value = currentProjectKey && keys.includes(currentProjectKey) ? currentProjectKey : '';
}

function renderPersonList() {
    const personList = document.getElementById('person-list');
    if (!personList) return;
    personList.innerHTML = tasksMany
        .filter((task) => task.type === 'person')
        .map((task) => {
            const selected = task.id === selectedTaskId ? ' sel' : '';
            return `<div class="grid-row${selected}" data-id="${task.id}"><div class="c-name">${task.name}</div></div>`;
        })
        .join('');
}

function renderItemDetail(task) {
    const detailDiv = document.getElementById('item-detail');
    if (!detailDiv) return;

    if (!task) {
        detailDiv.innerHTML = '<label>Select a bar to inspect details.</label>';
        selectedTaskId = null;
        renderPersonList();
        return;
    }

    selectedTaskId = task.id;
    const stored = tasksMany.find((item) => item.id === task.id) || task;
    const startStr = stored.start || (task._start ? formatDate(task._start) : '');
    const endStr = isOpenEnded(stored.end)
        ? 'Present'
        : stored.end || (task._end ? formatDate(task._end) : '');
    const lines = [];

    if (task.type === 'person') {
        const { career = [], family = [] } = getRelatedTasks(task);
        lines.push(`<label><span class="detail-key">Name:</span> ${task.name}</label>`);
        if (task.description) lines.push(`<label>${task.description}</label>`);
        if (career.length) {
            lines.push('<label class="detail-key">Career:</label>');
            lines.push(`<ul class="detail-list">${career.map((c) => `<li>${c.name}</li>`).join('')}</ul>`);
        }
        if (family.length) {
            lines.push('<label class="detail-key">Family:</label>');
            lines.push(`<ul class="detail-list">${family.map((f) => `<li>${f.name}</li>`).join('')}</ul>`);
        }
    } else if (task.type === 'position') {
        const { parent } = getRelatedTasks(task);
        lines.push(`<label><span class="detail-key">Name:</span> ${parent ? parent.name : ''}</label>`);
        lines.push(`<label><span class="detail-key">Position:</span> ${task.name}</label>`);
        lines.push(`<label><span class="detail-key">Start date:</span> ${startStr}</label>`);
        lines.push(`<label><span class="detail-key">End date:</span> ${endStr}</label>`);
        if (task.description) lines.push(`<label>${task.description}</label>`);
    }

    lines.push(
        '<div class="detail-actions">' +
            '<button type="button" class="btn" id="btn-edit-item">Edit</button>' +
            '<button type="button" class="btn" id="btn-delete-item">Delete</button>' +
            '</div>',
    );
    detailDiv.innerHTML = lines.join('\n');
    renderPersonList();
}

function applyTasks(list, { refreshChart = true } = {}) {
    tasksMany = processTasks(list);
    if (selectedTaskId && !tasksMany.some((item) => item.id === selectedTaskId)) {
        selectedTaskId = null;
    }
    if (refreshChart) renderChart();
    else renderPersonList();
    const selected = tasksMany.find((item) => item.id === selectedTaskId);
    if (selected) renderItemDetail(selected);
    else renderItemDetail(null);
}

function renderChart() {
    if (!tasksMany.length) {
        const host = document.getElementById('historix-gantt');
        if (host) host.innerHTML = '';
        gantt = null;
        renderPersonList();
        return;
    }

    const options = {
        ...GANTT_OPTIONS,
        popup: (ctx) => {
            const task = ctx.task;
            const stored = tasksMany.find((item) => item.id === task.id) || task;
            const endLabel = isOpenEnded(stored.end) ? 'Present' : formatDate(ctx.task._end);
            ctx.set_title(task.name);
            ctx.set_subtitle(task.description || '');
            ctx.set_details(
                task.type === 'position'
                    ? `${formatDate(ctx.task._start)} - ${endLabel}<br/>${formatDuration(task.actual_duration)}`
                    : '',
            );
            renderItemDetail(stored);
        },
        on_date_change: (task, start, end) => {
            if (task.type === 'person') {
                applyTasks(tasksMany);
                return;
            }
            const current = tasksMany.find((item) => item.id === task.id);
            if (!current) return;
            current.start = formatDate(start);
            current.end = formatDate(end);
            applyTasks(tasksMany);
        },
    };

    const chartTasks = tasksForChart(tasksMany);
    if (gantt) {
        gantt.refresh(chartTasks);
    } else {
        gantt = new Gantt('#historix-gantt', chartTasks, options);
    }
    renderPersonList();
}

function setModalError(message) {
    const el = document.getElementById('item-modal-error');
    if (!el) return;
    if (!message) {
        el.hidden = true;
        el.textContent = '';
        return;
    }
    el.hidden = false;
    el.textContent = message;
}

function syncModalTypeFields() {
    const type = document.getElementById('item-type').value;
    const positionFields = document.getElementById('position-fields');
    positionFields.hidden = type !== 'position';
}

function getSelectedDepIds() {
    return [...document.querySelectorAll('#item-deps input:checked')].map((input) => input.value);
}

function fillDependencyBoxes(selectedIds, currentId) {
    const container = document.getElementById('item-deps');
    const type = document.getElementById('item-type').value;
    const isPosition = type === 'position';
    const inputType = isPosition ? 'radio' : 'checkbox';
    const personOptions = tasksMany.filter((item) => item.type === 'person' && item.id !== currentId);
    if (!personOptions.length) {
        container.innerHTML = '<label>No other persons yet.</label>';
        return;
    }

    const selected = selectedIds.filter((id) => personOptions.some((item) => item.id === id));
    const checkedId = isPosition ? selected[0] || '' : '';

    container.innerHTML = personOptions
        .map((item) => {
            const checked = isPosition ? item.id === checkedId : selected.includes(item.id);
            const nameAttr = isPosition ? 'name="item-dep"' : '';
            return `<label><input type="${inputType}" ${nameAttr} value="${item.id}" ${checked ? 'checked' : ''}> ${item.name}</label>`;
        })
        .join('');
}

function readModalDraft() {
    const deps = getSelectedDepIds();
    return {
        type: document.getElementById('item-type').value,
        id: document.getElementById('item-id').value.trim(),
        name: document.getElementById('item-name').value.trim(),
        description: document.getElementById('item-description').value.trim(),
        start: document.getElementById('item-start').value.trim(),
        end: normalizeEnd(document.getElementById('item-end').value),
        dependencies: deps,
    };
}

function setModalLocked(locked, { nameUnlocked = false, descriptionUnlocked = false, depsUnlocked = false } = {}) {
    document.getElementById('item-type').disabled = locked;
    document.getElementById('item-description').readOnly = locked && !descriptionUnlocked;
    document.getElementById('item-start').readOnly = locked;
    document.getElementById('item-end').readOnly = locked;
    document.getElementById('item-name').readOnly = locked && !nameUnlocked;
    for (const input of document.querySelectorAll('#item-deps input')) {
        input.disabled = locked && !depsUnlocked;
    }
}

function openItemModal(mode, task) {
    modalMode = mode;
    const modal = document.getElementById('item-modal');
    const title = document.getElementById('item-modal-title');
    title.textContent = mode === 'create' ? 'New Item' : 'Edit Item';
    setModalError('');

    if (mode === 'create') {
        document.getElementById('item-type').value = 'person';
        document.getElementById('item-id').value = generateId('person');
        document.getElementById('item-name').value = '';
        document.getElementById('item-description').value = '';
        document.getElementById('item-start').value = '';
        document.getElementById('item-end').value = '';
        fillDependencyBoxes([], document.getElementById('item-id').value);
        setModalLocked(false);
    } else {
        document.getElementById('item-type').value = task.type;
        document.getElementById('item-id').value = task.id;
        document.getElementById('item-name').value = task.name || '';
        document.getElementById('item-description').value = task.description || '';
        document.getElementById('item-start').value = task.start || '';
        document.getElementById('item-end').value = task.end || '';
        fillDependencyBoxes(getDeps(task.dependencies), task.id);
        if (task.type === 'person') {
            setModalLocked(true, { nameUnlocked: true, descriptionUnlocked: true, depsUnlocked: true });
        }
        else setModalLocked(false);
        document.getElementById('item-type').disabled = true;
    }

    syncModalTypeFields();
    modal.hidden = false;
}

function closeItemModal() {
    document.getElementById('item-modal').hidden = true;
}

function submitItemModal() {
    const draft = readModalDraft();
    const isNew = modalMode === 'create';
    const errors = validateItem(draft, { isNew });
    if (errors.length) {
        setModalError(errors.join(' '));
        return;
    }

    if (isNew) {
        const item = cloneItem(draft);
        if (item.type === 'person') {
            const today = todayYmd();
            item.start = today;
            item.end = today;
        }
        applyTasks([...tasksMany, item]);
    } else {
        const next = tasksMany.map((item) => {
            if (item.id !== draft.id) return item;
            if (item.type === 'person') {
                return {
                    ...cloneItem(item),
                    name: draft.name,
                    description: draft.description,
                    dependencies: draft.dependencies,
                };
            }
            return cloneItem(draft);
        });
        applyTasks(next);
    }
    closeItemModal();
}

function deleteSelectedItem() {
    const task = tasksMany.find((item) => item.id === selectedTaskId);
    if (!task) return;
    if (!confirm(`Delete "${task.name}"?`)) return;

    let remaining = tasksMany.filter((item) => item.id !== task.id);
    if (task.type === 'person') {
        remaining = remaining.filter((item) => {
            if (item.type !== 'position') return true;
            return getParentPerson(item, tasksMany)?.id !== task.id;
        });
        remaining = remaining.map((item) => ({
            ...cloneItem(item),
            dependencies: getDeps(item.dependencies).filter((dep) => dep !== task.id),
        }));
    }
    selectedTaskId = null;
    applyTasks(remaining);
}

function saveProject() {
    let key = currentProjectKey;
    if (!key) {
        key = prompt('Save project as (localStorage key):');
        if (!key) return;
        key = key.trim();
        if (!key) return;
    }
    localStorage.setItem(key, JSON.stringify(processTasks(tasksMany).map(cloneItem)));
    currentProjectKey = key;
    refreshProjectSelect();
    alert('Project saved successfully!');
}

function renameProject() {
    if (!currentProjectKey) {
        saveProject();
        return;
    }
    const nextName = prompt('Rename project to:', currentProjectKey);
    if (!nextName) return;
    const key = nextName.trim();
    if (!key || key === currentProjectKey) return;
    if (localStorage.getItem(key)) {
        alert('A project with that name already exists.');
        return;
    }
    localStorage.setItem(key, localStorage.getItem(currentProjectKey));
    localStorage.removeItem(currentProjectKey);
    currentProjectKey = key;
    refreshProjectSelect();
}

function deleteProject() {
    if (!currentProjectKey) {
        alert('No saved project is selected.');
        return;
    }
    if (!confirm(`Delete project "${currentProjectKey}" from localStorage?`)) return;
    localStorage.removeItem(currentProjectKey);
    showEmptyProject();
}

function loadProject(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
        const parsed = JSON.parse(raw);
        currentProjectKey = key;
        applyTasks(parsed);
        refreshProjectSelect();
    } catch (error) {
        alert('Could not load that project.');
    }
}

async function resetFromDemo() {
    const response = await fetch('./demo.json');
    const demo = await response.json();
    currentProjectKey = '';
    applyTasks(demo);
    refreshProjectSelect();
}

function bindUi() {
    document.getElementById('btn-save').addEventListener('click', saveProject);
    document.getElementById('btn-rename').addEventListener('click', renameProject);
    document.getElementById('btn-delete-project').addEventListener('click', deleteProject);
    document.getElementById('btn-new-item').addEventListener('click', () => openItemModal('create'));
    document.getElementById('btn-reset').addEventListener('click', () => {
        resetFromDemo();
    });
    
    // CSV Import bindings
    document.getElementById('btn-import-csv').addEventListener('click', () => {
        document.getElementById('csv-file-input').click();
    });

    document.getElementById('csv-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target.result;
            try {
                const parsed = parseCSV(text);
                
                if (parsed.length === 0) {
                    throw new Error("CSV file is empty.");
                }

                // Check headers
                const firstRow = parsed[0];
                if (!('position' in firstRow) || !('start' in firstRow) || !('end' in firstRow)) {
                    throw new Error("CSV must have 'position', 'start', and 'end' columns.");
                }

                // Verify rows data format
                for (let i = 0; i < parsed.length; i++) {
                    const row = parsed[i];
                    if (!row.position) {
                        throw new Error(`Row ${i + 2}: 'position' cannot be empty.`);
                    }
                    if (!parseYmd(row.start)) {
                        throw new Error(`Row ${i + 2}: 'start' date is missing or invalid. Must be YYYY/MM/DD.`);
                    }
                    const end = normalizeEnd(row.end);
                    if (end !== null && !parseYmd(end)) {
                        throw new Error(`Row ${i + 2}: 'end' date is invalid. Must be YYYY/MM/DD or empty for Present.`);
                    }
                    if (end !== null && toDateInt(end) < toDateInt(row.start)) {
                        throw new Error(`Row ${i + 2}: 'end' date must be greater than or equal to 'start' date.`);
                    }
                }
                
                currentCsvData = parsed;
                document.getElementById('csv-person-name').value = '';
                document.getElementById('csv-modal-error').hidden = true;
                const tbody = document.getElementById('csv-preview-body');
                tbody.innerHTML = parsed.map(row =>
                    `<tr>
                        <td style="padding: 4px 8px; border-bottom: 1px solid var(--border);">${row.position}</td>
                        <td style="padding: 4px 8px; border-bottom: 1px solid var(--border);">${row.start}</td>
                        <td style="padding: 4px 8px; border-bottom: 1px solid var(--border);">${normalizeEnd(row.end) === null ? 'Present' : row.end}</td>
                    </tr>`
                ).join('');
                document.getElementById('csv-modal').hidden = false;
            } catch (err) {
                alert(err.message || 'Failed to parse CSV');
            }
        };
        reader.readAsText(file);
        e.target.value = ''; // Reset input
    });

    document.getElementById('csv-cancel').addEventListener('click', () => {
        document.getElementById('csv-modal').hidden = true;
    });

    document.getElementById('csv-submit').addEventListener('click', () => {
        const personName = document.getElementById('csv-person-name').value.trim();
        if (!personName) {
            const err = document.getElementById('csv-modal-error');
            err.textContent = 'Please enter a person name.';
            err.hidden = false;
            return;
        }

        const personId = generateId('person');
        const personItem = {
            id: personId,
            name: personName,
            start: '',
            end: '',
            dependencies: [],
            description: '',
            type: 'person'
        };

        const newTasks = [...tasksMany, personItem];
        for (const row of currentCsvData) {
             const prefix = 'position';
             let n = 1;
             while (newTasks.some(t => t.id === `${prefix}_${n}`)) n++;
             const pos = {
                id: `${prefix}_${n}`,
                name: row.position || 'Unknown',
                start: row.start || '',
                end: normalizeEnd(row.end),
                dependencies: [personId],
                description: '',
                type: 'position'
             };
             newTasks.push(pos);
        }
        applyTasks(newTasks);
        document.getElementById('csv-modal').hidden = true;
    });

    document.getElementById('project-select').addEventListener('change', (event) => {
        if (event.target.value) loadProject(event.target.value);
        else showEmptyProject();
    });
    document.getElementById('item-type').addEventListener('change', () => {
        if (modalMode === 'create') {
            document.getElementById('item-id').value = generateId(document.getElementById('item-type').value);
            fillDependencyBoxes(getSelectedDepIds(), document.getElementById('item-id').value);
        }
        syncModalTypeFields();
    });
    document.getElementById('item-cancel').addEventListener('click', closeItemModal);
    document.getElementById('item-submit').addEventListener('click', submitItemModal);
    document.getElementById('item-modal').addEventListener('click', (event) => {
        if (event.target.id === 'item-modal') closeItemModal();
    });
    document.getElementById('csv-modal').addEventListener('click', (event) => {
        if (event.target.id === 'csv-modal') document.getElementById('csv-modal').hidden = true;
    });
    document.getElementById('person-list').addEventListener('click', (event) => {
        const row = event.target.closest('[data-id]');
        if (!row) return;
        const task = tasksMany.find((item) => item.id === row.dataset.id);
        if (task) {
            renderItemDetail(task);
            const barWrapper = document.querySelector(`.bar-wrapper[data-id="${task.id}"]`);
            if (barWrapper) {
                barWrapper.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            }
        }
    });
    document.getElementById('item-detail').addEventListener('click', (event) => {
        if (event.target.id === 'btn-edit-item') {
            const task = tasksMany.find((item) => item.id === selectedTaskId);
            if (task) openItemModal('edit', task);
        }
        if (event.target.id === 'btn-delete-item') deleteSelectedItem();
    });
}

function init() {
    bindUi();
    showEmptyProject();
}

init();